import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ── Configuration ──────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MCP_SERVER_PATH = path.resolve(__dirname, "../mcp-server/index.js");
const MCP_SERVER_CWD = path.dirname(MCP_SERVER_PATH);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
let mcpClient = null;
let mcpTransport = null;
let anthropicTools = null;
let mcpConnectionPromise = null;

function resetMcpConnection() {
  const transportToClose = mcpTransport;
  mcpClient = null;
  mcpTransport = null;
  anthropicTools = null;
  mcpConnectionPromise = null;

  if (transportToClose) {
    transportToClose.close().catch(() => {});
  }
}

function mapMcpToolsToAnthropic(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function formatMcpToolContentBlock(block) {
  switch (block.type) {
    case "text":
      return block.text;
    case "resource_link":
      return block.name ? `${block.name}: ${block.uri}` : block.uri;
    case "resource":
      return JSON.stringify(block.resource, null, 2);
    default:
      return JSON.stringify(block, null, 2);
  }
}

function formatMcpToolResult(result) {
  if (result.structuredContent && Object.keys(result.structuredContent).length > 0) {
    return JSON.stringify(result.structuredContent, null, 2);
  }

  const textContent = result.content.map(formatMcpToolContentBlock).filter(Boolean).join("\n");
  if (textContent) return textContent;

  return JSON.stringify(result, null, 2);
}

async function getMcpConnection() {
  if (mcpClient && mcpTransport && anthropicTools) {
    return { client: mcpClient, tools: anthropicTools };
  }

  if (mcpConnectionPromise) return mcpConnectionPromise;

  mcpConnectionPromise = (async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MCP_SERVER_PATH],
      cwd: MCP_SERVER_CWD,
      env: { ...process.env },
      stderr: "pipe",
    });

    if (transport.stderr) {
      transport.stderr.on("data", (chunk) => {
        const message = chunk.toString().trim();
        if (message) console.error(`[mcp] ${message}`);
      });
    }

    transport.onclose = () => {
      mcpClient = null;
      mcpTransport = null;
      anthropicTools = null;
      mcpConnectionPromise = null;
    };

    transport.onerror = (error) => {
      console.error("MCP transport error:", error.message);
    };

    const client = new Client(
      { name: "listing-agent-backend", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);
    const { tools } = await client.listTools();

    mcpClient = client;
    mcpTransport = transport;
    anthropicTools = mapMcpToolsToAnthropic(tools);

    return { client, tools: anthropicTools };
  })().catch((error) => {
    resetMcpConnection();
    throw error;
  });

  return mcpConnectionPromise;
}

async function executeTool(toolName, toolInput) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { client } = await getMcpConnection();
      const result = await client.callTool({
        name: toolName,
        arguments: toolInput,
      });

      return formatMcpToolResult(result);
    } catch (error) {
      lastError = error;
      resetMcpConnection();
    }
  }

  throw lastError;
}

// ── Chat Endpoint ─────────────────────────────────────────────
const conversationHistory = new Map(); // sessionId -> messages[]

app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId = "default" } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    const { tools } = await getMcpConnection();

    // Get or create conversation history
    if (!conversationHistory.has(sessionId)) {
      conversationHistory.set(sessionId, []);
    }
    const messages = conversationHistory.get(sessionId);

    // Add user message
    messages.push({ role: "user", content: message });

    const systemPrompt = `You are a helpful AI assistant for a short-term stay booking platform (like Airbnb).
You help users with three main tasks:
1. **Query Listings** - Search and browse available listings
2. **Book a Listing** - Make a reservation for a listing
3. **Review a Listing** - Leave a review for a completed stay

When a user asks to see listings, use the query_listings tool after you have these required details: country, city, check-in date, check-out date, and number of guests.
When a user wants to book, use the book_listing tool after you have the listing ID, check-in date, check-out date, and the full list of guest names.
When a user wants to review, use the review_listing tool after you have the booking ID and rating. A comment is optional.

Always be friendly and provide clear information. Format listing results nicely.
If the user provides partial info, ask for the missing details before making a tool call.
For dates, prefer YYYY-MM-DD format unless the user gives a full datetime.`;

    // Call Claude with tools — agentic loop
    let currentMessages = [...messages];
    let finalResponse = "";

    while (true) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages: currentMessages,
      });

      // Check if there are tool uses
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      const textBlocks = response.content.filter((b) => b.type === "text");

      if (toolUseBlocks.length > 0) {
        // Execute each tool call
        const assistantContent = response.content;
        currentMessages.push({ role: "assistant", content: assistantContent });

        const toolResults = [];
        for (const toolUse of toolUseBlocks) {
          console.log(`Calling tool: ${toolUse.name}`, toolUse.input);
          const result = await executeTool(toolUse.name, toolUse.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          });
        }

        currentMessages.push({ role: "user", content: toolResults });

        // Continue the loop to let Claude process tool results
        continue;
      }

      // No more tool calls — extract final text
      finalResponse = textBlocks.map((b) => b.text).join("\n");
      break;
    }

    // Update conversation history (keep last 20 messages to avoid token limits)
    const updatedMessages = currentMessages.slice(-20);
    updatedMessages.push({ role: "assistant", content: finalResponse });
    conversationHistory.set(sessionId, updatedMessages);

    res.json({ response: finalResponse, sessionId });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ── Clear conversation ────────────────────────────────────────
app.post("/api/chat/clear", (req, res) => {
  const { sessionId = "default" } = req.body;
  conversationHistory.delete(sessionId);
  res.json({ message: "Conversation cleared" });
});

// ── Health check ──────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "Agent backend running", timestamp: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Agent backend running on http://localhost:${PORT}`);
});

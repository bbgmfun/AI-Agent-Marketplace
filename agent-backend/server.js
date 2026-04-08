import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
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
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "auto").trim().toLowerCase();
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
const anthropicConfigured = Boolean(
  anthropicApiKey &&
    anthropicApiKey !== "dummy" &&
    anthropicApiKey !== "your_anthropic_api_key_here"
);
const anthropicClient = anthropicConfigured ? new Anthropic({ apiKey: anthropicApiKey }) : null;
const ollamaClient = new Anthropic({
  baseURL: OLLAMA_BASE_URL,
  apiKey: "ollama",
});
let mcpClient = null;
let mcpTransport = null;
let llmTools = null;
let mcpConnectionPromise = null;

function getAnthropicConfigError() {
  return "Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY in agent-backend/.env and restart the backend.";
}

function getOllamaInstallError() {
  return `Ollama is not reachable at ${OLLAMA_BASE_URL}. Install Ollama, start the service, and try again.`;
}

function getOllamaModelError() {
  return `Ollama is running but the model '${OLLAMA_MODEL}' is not installed. Run: ollama pull ${OLLAMA_MODEL}`;
}

function getMissingLlmError() {
  return `No live LLM is configured. Free option: install Ollama, start it, and pull '${OLLAMA_MODEL}'. Paid option: set ANTHROPIC_API_KEY.`;
}

async function getOllamaStatus() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) {
      return {
        available: false,
        modelReady: false,
        models: [],
      };
    }

    const data = await response.json();
    const models = Array.isArray(data?.models) ? data.models.map((model) => model.name).filter(Boolean) : [];
    const modelReady = models.some((name) => {
      return (
        name === OLLAMA_MODEL ||
        name === `${OLLAMA_MODEL}:latest` ||
        name.startsWith(`${OLLAMA_MODEL}:`)
      );
    });

    return {
      available: true,
      modelReady,
      models,
    };
  } catch {
    return {
      available: false,
      modelReady: false,
      models: [],
    };
  }
}

async function resolveLlmConfig() {
  const ollamaStatus = await getOllamaStatus();

  if (LLM_PROVIDER === "ollama") {
    if (!ollamaStatus.available) throw new Error(getOllamaInstallError());
    if (!ollamaStatus.modelReady) throw new Error(getOllamaModelError());
    return {
      provider: "ollama",
      client: ollamaClient,
      model: OLLAMA_MODEL,
      ollamaStatus,
    };
  }

  if (LLM_PROVIDER === "anthropic") {
    if (!anthropicClient) throw new Error(getAnthropicConfigError());
    return {
      provider: "anthropic",
      client: anthropicClient,
      model: ANTHROPIC_MODEL,
      ollamaStatus,
    };
  }

  if (ollamaStatus.available && ollamaStatus.modelReady) {
    return {
      provider: "ollama",
      client: ollamaClient,
      model: OLLAMA_MODEL,
      ollamaStatus,
    };
  }

  if (anthropicClient) {
    return {
      provider: "anthropic",
      client: anthropicClient,
      model: ANTHROPIC_MODEL,
      ollamaStatus,
    };
  }

  if (ollamaStatus.available && !ollamaStatus.modelReady) {
    throw new Error(getOllamaModelError());
  }

  throw new Error(getMissingLlmError());
}

function resetMcpConnection() {
  const transportToClose = mcpTransport;
  mcpClient = null;
  mcpTransport = null;
  llmTools = null;
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
  if (mcpClient && mcpTransport && llmTools) {
    return { client: mcpClient, tools: llmTools };
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
      llmTools = null;
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
    llmTools = mapMcpToolsToAnthropic(tools);

    return { client, tools: llmTools };
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

function safeParseJson(value) {
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getSessionContext(sessionContexts, sessionId) {
  if (!sessionContexts.has(sessionId)) {
    sessionContexts.set(sessionId, {});
  }

  return sessionContexts.get(sessionId);
}

function updateSessionContextFromTool(sessionContexts, sessionId, toolName, toolInput, toolResult) {
  const parsedResult = safeParseJson(toolResult);
  if (!parsedResult || parsedResult.success !== true) return;

  const context = getSessionContext(sessionContexts, sessionId);

  if (toolName === "book_listing" && parsedResult.bookingId != null) {
    context.lastBooking = {
      bookingId: parsedResult.bookingId,
      listingId: toolInput.listing_id,
      fromDate: toolInput.from_date,
      toDate: toolInput.to_date,
      guestNames: Array.isArray(toolInput.guest_names) ? toolInput.guest_names : [],
    };
  }

  if (toolName === "review_listing" && parsedResult.reviewId != null) {
    context.lastReview = {
      reviewId: parsedResult.reviewId,
      bookingId: toolInput.booking_id,
      rating: toolInput.rating,
      comment: toolInput.comment || null,
    };
  }
}

function buildSessionContextPrompt(sessionContexts, sessionId) {
  const context = sessionContexts.get(sessionId);
  if (!context) return "";

  const lines = [];

  if (context.lastBooking?.bookingId != null) {
    const bookingBits = [
      `Recent booking in this session: booking ID ${context.lastBooking.bookingId}`,
      context.lastBooking.listingId != null
        ? `listing ID ${context.lastBooking.listingId}`
        : null,
      context.lastBooking.fromDate && context.lastBooking.toDate
        ? `dates ${context.lastBooking.fromDate} to ${context.lastBooking.toDate}`
        : null,
      context.lastBooking.guestNames?.length
        ? `guests ${context.lastBooking.guestNames.join(", ")}`
        : null,
    ].filter(Boolean);

    lines.push(`- ${bookingBits.join(", ")}.`);
  }

  if (context.lastReview?.reviewId != null) {
    lines.push(
      `- Most recent review: review ID ${context.lastReview.reviewId} for booking ID ${context.lastReview.bookingId} with rating ${context.lastReview.rating}/5.`
    );
  }

  if (lines.length === 0) return "";

  return [
    "Session context:",
    ...lines,
    "- If the user refers to their latest booking, 'that booking', or wants to review right after booking, use the recent booking above unless they specify a different booking ID.",
  ].join("\n");
}

function trimConversationHistory(messages, maxMessages) {
  if (messages.length <= maxMessages) {
    return messages;
  }

  const trimmed = messages.slice(-maxMessages);

  while (trimmed.length > 0) {
    const firstMessage = trimmed[0];
    const contentBlocks = Array.isArray(firstMessage.content) ? firstMessage.content : [];
    const startsWithToolProtocol =
      contentBlocks.some((block) => block.type === "tool_use") ||
      contentBlocks.some((block) => block.type === "tool_result");

    if (!startsWithToolProtocol) {
      break;
    }

    trimmed.shift();
  }

  return trimmed;
}

// ── Chat Endpoint ─────────────────────────────────────────────
const conversationHistory = new Map(); // sessionId -> Anthropic message history
const sessionContexts = new Map(); // sessionId -> recent booking/review context
const MAX_HISTORY_MESSAGES = 20;
const MAX_AGENT_STEPS = 8;

app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId = "default" } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    const llm = await resolveLlmConfig();
    const { tools } = await getMcpConnection();

    // Get or create conversation history
    if (!conversationHistory.has(sessionId)) {
      conversationHistory.set(sessionId, []);
    }
    const priorMessages = conversationHistory.get(sessionId);

    const currentMessages = [...priorMessages, { role: "user", content: message }];
    const sessionContextPrompt = buildSessionContextPrompt(sessionContexts, sessionId);

    const systemPrompt = `You are a helpful AI assistant for a short-term stay booking platform (like Airbnb).
You help users with three main tasks:
1. **Query Listings** - Search and browse available listings
2. **Book a Listing** - Make a reservation for a listing
3. **Review a Listing** - Leave a review for a completed stay

When a user asks to see listings, use the query_listings tool after you have these required details: country, city, check-in date, check-out date, and number of guests.
When a user wants to book, use the book_listing tool after you have the listing ID, check-in date, check-out date, and the full list of guest names.
When a user wants to review, use the review_listing tool after you have the booking ID and rating. A comment is optional.
Users may write in Turkish or English. Understand both and prefer replying in the user's language.

Always be friendly and provide clear information. Format listing results nicely.
If the user provides partial info, ask for the missing details before making a tool call.
For dates, prefer YYYY-MM-DD format unless the user gives a full datetime.
After a successful booking, explicitly mention the booking ID and guest names in your reply.
After a successful review, explicitly mention the booking ID, rating, and review ID when available.
If the user wants to review the booking they just made and the session context already includes a recent booking ID, use that booking ID instead of asking for it again. Only ask for the missing rating or comment.
${sessionContextPrompt ? `\n\n${sessionContextPrompt}` : ""}`;

    let finalResponse = "";
    let steps = 0;

    while (true) {
      steps += 1;
      if (steps > MAX_AGENT_STEPS) {
        throw new Error("The agent exceeded the maximum number of tool-calling steps.");
      }

      const response = await llm.client.messages.create({
        model: llm.model,
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
          updateSessionContextFromTool(
            sessionContexts,
            sessionId,
            toolUse.name,
            toolUse.input,
            result
          );
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

    currentMessages.push({ role: "assistant", content: finalResponse });
    conversationHistory.set(
      sessionId,
      trimConversationHistory(currentMessages, MAX_HISTORY_MESSAGES)
    );

    res.json({ response: finalResponse, sessionId, provider: llm.provider });
  } catch (err) {
    console.error("Chat error:", err);
    if (err?.status === 401) {
      return res.status(502).json({
        error: `Anthropic authentication failed: ${err?.error?.error?.message || err.message}. Update ANTHROPIC_API_KEY in agent-backend/.env and restart the backend.`,
      });
    }

    if (typeof err?.message === "string") {
      if (
        err.message.includes("Ollama") ||
        err.message.includes("No live LLM") ||
        err.message.includes("maximum number of tool-calling steps")
      ) {
        return res.status(503).json({ error: err.message });
      }
    }

    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ── Clear conversation ────────────────────────────────────────
app.post("/api/chat/clear", (req, res) => {
  const { sessionId = "default" } = req.body;
  conversationHistory.delete(sessionId);
  sessionContexts.delete(sessionId);
  res.json({ message: "Conversation cleared" });
});

// ── Health check ──────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  const ollamaStatus = await getOllamaStatus();
  let liveReady = false;
  let activeProvider = null;

  try {
    const llm = await resolveLlmConfig();
    liveReady = true;
    activeProvider = llm.provider;
  } catch {}

  res.json({
    status: "Agent backend running",
    liveReady,
    activeProvider,
    preferredProvider: LLM_PROVIDER,
    anthropicConfigured,
    anthropicModel: ANTHROPIC_MODEL,
    ollamaAvailable: ollamaStatus.available,
    ollamaModelReady: ollamaStatus.modelReady,
    ollamaModel: OLLAMA_MODEL,
    ollamaBaseUrl: OLLAMA_BASE_URL,
    timestamp: new Date().toISOString(),
  });
});

// ── Serve React frontend in production ────────────────────────
const frontendBuild = path.resolve(__dirname, "../frontend/build");
if (fs.existsSync(frontendBuild)) {
  app.use(express.static(frontendBuild));
  app.get("*", (req, res) => {
    res.sendFile(path.join(frontendBuild, "index.html"));
  });
  console.log("Serving React frontend from", frontendBuild);
}

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Agent backend running on http://localhost:${PORT}`);
});

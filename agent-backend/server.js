import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ── Configuration ──────────────────────────────────────────────
const API_BASE = process.env.API_BASE_URL || "https://stayapi-app.mangowater-b28dd996.swedencentral.azurecontainerapps.io";
const API_EMAIL = process.env.API_EMAIL || "guest@example.com";
const API_PASSWORD = process.env.API_PASSWORD || "guest123";
const PORT = process.env.PORT || 3001;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let cachedToken = null;
let tokenExpiry = 0;

// ── Auth Helper ────────────────────────────────────────────────
async function getAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: API_EMAIL, password: API_PASSWORD }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const data = await res.json();
    cachedToken = data.token;
    tokenExpiry = Date.now() + 50 * 60 * 1000;
    return cachedToken;
  } catch (err) {
    console.error("Auth error:", err.message);
    throw err;
  }
}

async function apiCall(method, path, body = null, auth = false) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getAuthToken();
    headers["Authorization"] = `Bearer ${token}`;
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

// ── MCP Tools Definition ──────────────────────────────────────
const tools = [
  {
    name: "query_listings",
    description:
      "Search available short-term stay listings. Returns a paginated list of listings with details like title, location, city, country, capacity, price per night, and description.",
    input_schema: {
      type: "object",
      properties: {
        page: {
          type: "number",
          description: "Page number for pagination (10 items per page). Default is 1.",
        },
      },
      required: [],
    },
  },
  {
    name: "book_listing",
    description:
      "Book a short-term stay listing. Requires listing ID, guest ID, check-in date, check-out date, and guest count. Optionally accepts guest names.",
    input_schema: {
      type: "object",
      properties: {
        listing_id: { type: "number", description: "The ID of the listing to book" },
        guest_id: { type: "number", description: "The ID of the guest making the booking" },
        from_date: { type: "string", description: "Check-in date in YYYY-MM-DD format" },
        to_date: { type: "string", description: "Check-out date in YYYY-MM-DD format" },
        guest_count: { type: "number", description: "Number of guests" },
        guest_names: { type: "string", description: "Comma-separated guest names (optional)" },
      },
      required: ["listing_id", "guest_id", "from_date", "to_date", "guest_count"],
    },
  },
  {
    name: "review_listing",
    description:
      "Submit a review for a completed stay. Requires booking ID, listing ID, guest ID, and a rating (1-5). Optionally accepts a comment.",
    input_schema: {
      type: "object",
      properties: {
        booking_id: { type: "number", description: "The booking ID to review" },
        listing_id: { type: "number", description: "The listing ID being reviewed" },
        guest_id: { type: "number", description: "The guest ID writing the review" },
        rating: { type: "number", description: "Rating from 1 to 5" },
        comment: { type: "string", description: "Optional review comment" },
      },
      required: ["booking_id", "listing_id", "guest_id", "rating"],
    },
  },
];

// ── MCP Tool Execution (maps tool calls to API Gateway) ───────
async function executeTool(toolName, toolInput) {
  switch (toolName) {
    case "query_listings": {
      const page = toolInput.page || 1;
      const { status, data } = await apiCall("GET", `/api/v1/listings?page=${page}`);
      if (status !== 200) return JSON.stringify({ error: data });
      return JSON.stringify({
        total: data.total,
        page: data.page,
        totalPages: data.totalPages,
        listings: data.listings,
      });
    }
    case "book_listing": {
      const body = {
        listing_id: toolInput.listing_id,
        guest_id: toolInput.guest_id,
        from_date: toolInput.from_date,
        to_date: toolInput.to_date,
        guest_count: toolInput.guest_count,
      };
      if (toolInput.guest_names) body.guest_names = toolInput.guest_names;
      const { status, data } = await apiCall("POST", "/api/v1/bookings", body, true);
      if (status === 201) {
        return JSON.stringify({ success: true, message: "Booking created successfully!", booking: data.booking });
      }
      return JSON.stringify({ success: false, error: data.error || data.message || "Booking failed" });
    }
    case "review_listing": {
      const body = {
        booking_id: toolInput.booking_id,
        listing_id: toolInput.listing_id,
        guest_id: toolInput.guest_id,
        rating: toolInput.rating,
      };
      if (toolInput.comment) body.comment = toolInput.comment;
      const { status, data } = await apiCall("POST", "/api/v1/reviews", body, true);
      if (status === 201) {
        return JSON.stringify({ success: true, message: "Review submitted successfully!", review: data.review });
      }
      return JSON.stringify({ success: false, error: data.error || data.message || "Review failed" });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ── Chat Endpoint ─────────────────────────────────────────────
const conversationHistory = new Map(); // sessionId -> messages[]

app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId = "default" } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

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

When a user asks to see listings, use the query_listings tool.
When a user wants to book, use the book_listing tool. The default guest_id is 1 unless specified.
When a user wants to review, use the review_listing tool. The default guest_id is 1 unless specified.

Always be friendly and provide clear information. Format listing results nicely.
If the user provides partial info, ask for the missing details before making a tool call.
For dates, use YYYY-MM-DD format.`;

    // Call Claude with tools — agentic loop
    let currentMessages = [...messages];
    let finalResponse = "";

    while (true) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        tools: tools,
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

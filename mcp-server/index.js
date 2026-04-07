import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";

// ── Configuration ──────────────────────────────────────────────
const API_BASE = process.env.API_BASE_URL || "https://stayapi-app.mangowater-b28dd996.swedencentral.azurecontainerapps.io";
const API_EMAIL = process.env.API_EMAIL || "guest@example.com";
const API_PASSWORD = process.env.API_PASSWORD || "guest123";

let cachedToken = null;
let tokenExpiry = 0;

// ── Helpers ────────────────────────────────────────────────────
async function getAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: API_EMAIL, password: API_PASSWORD }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Login failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    cachedToken = data.token;
    tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 min
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

// ── MCP Server ─────────────────────────────────────────────────
const server = new McpServer({
  name: "listing-mcp-server",
  version: "1.0.0",
});

// Tool 1: Query Listings
server.tool(
  "query_listings",
  "Search available short-term stay listings. Can filter by location/city/country and page number.",
  {
    page: z.number().optional().default(1).describe("Page number for pagination (10 items per page)"),
  },
  async ({ page }) => {
    try {
      const { status, data } = await apiCall("GET", `/api/v1/listings?page=${page}`);
      if (status !== 200) {
        return { content: [{ type: "text", text: `Error fetching listings: ${JSON.stringify(data)}` }] };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              total: data.total,
              page: data.page,
              totalPages: data.totalPages,
              listings: data.listings,
            }, null, 2),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// Tool 2: Book a Listing
server.tool(
  "book_listing",
  "Book a short-term stay listing for specified dates and guests.",
  {
    listing_id: z.number().describe("The ID of the listing to book"),
    guest_id: z.number().describe("The ID of the guest making the booking"),
    from_date: z.string().describe("Check-in date in YYYY-MM-DD format"),
    to_date: z.string().describe("Check-out date in YYYY-MM-DD format"),
    guest_count: z.number().describe("Number of guests"),
    guest_names: z.string().optional().describe("Comma-separated guest names"),
  },
  async ({ listing_id, guest_id, from_date, to_date, guest_count, guest_names }) => {
    try {
      const body = { listing_id, guest_id, from_date, to_date, guest_count };
      if (guest_names) body.guest_names = guest_names;

      const { status, data } = await apiCall("POST", "/api/v1/bookings", body, true);

      if (status === 201) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Booking created successfully!",
                booking: data.booking,
              }, null, 2),
            },
          ],
        };
      } else {
        return {
          content: [{ type: "text", text: `Booking failed (${status}): ${JSON.stringify(data)}` }],
        };
      }
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// Tool 3: Review a Listing
server.tool(
  "review_listing",
  "Submit a review for a completed stay at a listing.",
  {
    booking_id: z.number().describe("The booking ID to review"),
    listing_id: z.number().describe("The listing ID being reviewed"),
    guest_id: z.number().describe("The guest ID writing the review"),
    rating: z.number().min(1).max(5).describe("Rating from 1 to 5"),
    comment: z.string().optional().describe("Optional review comment"),
  },
  async ({ booking_id, listing_id, guest_id, rating, comment }) => {
    try {
      const body = { booking_id, listing_id, guest_id, rating };
      if (comment) body.comment = comment;

      const { status, data } = await apiCall("POST", "/api/v1/reviews", body, true);

      if (status === 201) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Review submitted successfully!",
                review: data.review,
              }, null, 2),
            },
          ],
        };
      } else {
        return {
          content: [{ type: "text", text: `Review failed (${status}): ${JSON.stringify(data)}` }],
        };
      }
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// ── Start Server ───────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Listing MCP Server running on stdio");
}

main().catch(console.error);

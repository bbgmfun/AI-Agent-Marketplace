import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";

// ── Configuration ──────────────────────────────────────────────
const API_BASE = process.env.API_BASE_URL || "https://stayapi-app.mangowater-b28dd996.swedencentral.azurecontainerapps.io";
const API_USERNAME = process.env.API_USERNAME || process.env.API_EMAIL || "se4458_listing_guest";
const API_PASSWORD = process.env.API_PASSWORD || "guest123";
const API_ROLE = process.env.API_ROLE || "Guest";

let cachedToken = null;
let tokenExpiry = 0;

// ── Helpers ────────────────────────────────────────────────────
function normalizeDateTime(value) {
  if (value.includes("T")) return value;
  return `${value}T00:00:00Z`;
}

async function parseResponse(res) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function formatApiError(data) {
  if (!data) return "No response body";
  if (typeof data === "string") return data;
  if (data.raw) return data.raw;
  if (data.error) return data.error;
  if (data.message) return data.message;
  return JSON.stringify(data);
}

async function registerGuestUser() {
  const res = await fetch(`${API_BASE}/api/v1/Auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: API_USERNAME,
      password: API_PASSWORD,
      role: API_ROLE,
    }),
  });

  const data = await parseResponse(res);
  if (!res.ok) {
    throw new Error(`Register failed (${res.status}): ${formatApiError(data)}`);
  }

  if (!data?.token) {
    throw new Error("Register succeeded but no token was returned");
  }

  cachedToken = data.token;
  tokenExpiry = Date.now() + 50 * 60 * 1000;
  return cachedToken;
}

async function getAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  try {
    const res = await fetch(`${API_BASE}/api/v1/Auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: API_USERNAME, password: API_PASSWORD }),
    });
    const data = await parseResponse(res);

    if (res.status === 401) {
      return await registerGuestUser();
    }

    if (!res.ok) {
      throw new Error(`Login failed (${res.status}): ${formatApiError(data)}`);
    }

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
  const data = await parseResponse(res);
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
  "Search available listings by date range, guest count, country, city, and optional pagination.",
  {
    date_from: z.string().describe("Check-in date in YYYY-MM-DD or ISO datetime format"),
    date_to: z.string().describe("Check-out date in YYYY-MM-DD or ISO datetime format"),
    no_of_people: z.number().min(1).max(50).describe("Number of guests"),
    country: z.string().describe("Country to search in"),
    city: z.string().describe("City to search in"),
    page: z.number().optional().default(1).describe("Page number for pagination"),
    page_size: z.number().optional().describe("Optional page size"),
  },
  async ({ date_from, date_to, no_of_people, country, city, page, page_size }) => {
    try {
      const params = new URLSearchParams({
        DateFrom: normalizeDateTime(date_from),
        DateTo: normalizeDateTime(date_to),
        NoOfPeople: String(no_of_people),
        Country: country,
        City: city,
        Page: String(page),
      });

      if (page_size) {
        params.set("PageSize", String(page_size));
      }

      const { status, data } = await apiCall("GET", `/api/v1/Listings/search?${params.toString()}`);
      if (status !== 200) {
        return { content: [{ type: "text", text: `Error fetching listings: ${formatApiError(data)}` }] };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              total: data.totalCount,
              page: data.page,
              pageSize: data.pageSize,
              totalPages: data.totalPages,
              listings: data.items,
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
  "Book a listing for a guest account using a listing ID, stay dates, and the full list of guest names.",
  {
    listing_id: z.number().describe("The ID of the listing to book"),
    from_date: z.string().describe("Check-in date in YYYY-MM-DD or ISO datetime format"),
    to_date: z.string().describe("Check-out date in YYYY-MM-DD or ISO datetime format"),
    guest_names: z.array(z.string()).min(1).describe("List of all guest names"),
  },
  async ({ listing_id, from_date, to_date, guest_names }) => {
    try {
      const body = {
        listingId: listing_id,
        dateFrom: normalizeDateTime(from_date),
        dateTo: normalizeDateTime(to_date),
        namesOfPeople: guest_names,
      };

      const { status, data } = await apiCall("POST", "/api/v1/Bookings", body, true);

      if (status === 200) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                status: data.status,
                message: data.message,
                bookingId: data.id,
              }, null, 2),
            },
          ],
        };
      } else {
        return {
          content: [{ type: "text", text: `Booking failed (${status}): ${formatApiError(data)}` }],
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
  "Submit a review for an existing booking using the booking ID, rating, and optional comment.",
  {
    booking_id: z.number().describe("The booking ID to review"),
    rating: z.number().min(1).max(5).describe("Rating from 1 to 5"),
    comment: z.string().optional().describe("Optional review comment"),
  },
  async ({ booking_id, rating, comment }) => {
    try {
      const body = { bookingId: booking_id, rating };
      if (comment) body.comment = comment;

      const { status, data } = await apiCall("POST", "/api/v1/Reviews", body, true);

      if (status === 200) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                status: data.status,
                message: data.message,
                reviewId: data.id,
              }, null, 2),
            },
          ],
        };
      } else {
        return {
          content: [{ type: "text", text: `Review failed (${status}): ${formatApiError(data)}` }],
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

AI Agent Chat Application for Short-Term Stay Listings


**Begum Bal**

## Project Overview
An AI-powered chat application that allows users to interact with a Short-Term Stay booking platform through natural language. The AI agent can search listings, make bookings, and submit reviews on behalf of the user.

## Source Code
- **GitHub:** https://github.com/bbgmfun/AI-Agent-Marketplace

## Existing Midterm API Deployment
- **Azure API Docs:** https://stayapi-app.mangowater-b28dd996.swedencentral.azurecontainerapps.io/api-docs/index.html
- This link is the previously deployed midterm StayAPI/gateway backend used by the AI agent, not a cloud deployment of the AI agent chat app itself.

## Demo Video
- **Video Link:** Add your OneDrive, Google Drive, or YouTube demo link here before submission.

---

## Architecture

```
┌──────────────────┐     ┌─────────────────────┐     ┌─────────────┐
│  React Frontend  │────▶│  Agent Backend       │────▶│  MCP Server │
│  (Chat UI)       │◀────│  (Node.js + Claude)  │stdio│  (Node.js)  │
└──────────────────┘     └─────────────────────┘     └──────┬──────┘
                                                            │
                                                    ┌───────▼───────┐
                                                    │  API Gateway   │
                                                    │  (Midterm API) │
                                                    └───────────────┘
```

### Components

| Component | Technology | Description |
|-----------|-----------|-------------|
| Frontend | React 18 | Chat UI with quick actions, markdown rendering, typing indicators |
| Agent Backend | Node.js + Express | Receives messages, sends them to Claude, acts as an MCP client over stdio, and relays tool calls/results |
| MCP Server | Node.js + @modelcontextprotocol/sdk | Exposes 3 tools (query_listings, book_listing, review_listing) and maps them to the API Gateway |
| LLM | Claude (Anthropic API) | Parses user intent, decides which MCP tool to call, formats responses |
| API Gateway | Midterm REST API | Existing Short-Term Stay API with JWT auth |

### Flow
1. User sends a message through the React chat UI
2. Agent backend receives the message and forwards it to Claude with conversation history
3. Agent backend starts the MCP server as a stdio child process and fetches the available tool schemas
4. Claude analyzes the user's intent and decides which MCP tool to call
5. Agent backend forwards that tool call to the MCP server over stdio
6. MCP server calls the API Gateway (midterm API) endpoint and returns the result
7. Claude formats the MCP tool result into a user-friendly reply
8. Response is displayed in the chat UI

---

## Design Decisions & Assumptions

### Design
- **Claude as LLM:** Used Anthropic's Claude API for superior tool-calling and natural language understanding
- **MCP Protocol:** Implemented a proper MCP server with stdio transport, with the agent backend connecting as an MCP client
- **Agentic Loop:** The agent backend runs a loop allowing Claude to make multiple tool calls per user message if needed
- **Session Management:** Each chat session has isolated conversation history to maintain context
- **JWT Auth Caching:** Auth tokens are cached for 50 minutes (token lifetime is 60 min) to minimize login requests
- **Constant Guest Account:** The MCP server logs in with a constant guest username/password, and auto-registers the guest account on first use if needed

### Assumptions
- The chat application uses a constant guest username/password for authenticated endpoints
- API credentials are configured via environment variables
- The midterm API is running and accessible at the configured URL
- Default pagination is 10 items per page

### Issues Encountered
- Rate limiting on the midterm API required implementing token caching
- Handling multi-step conversations (e.g., first query listings, then book one) required maintaining conversation history
- Formatting listing data in a readable way in chat required markdown rendering support

---

## API Endpoints Used

| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| Login | POST | /api/v1/Auth/login | No |
| Register guest user (fallback) | POST | /api/v1/Auth/register | No |
| Query Listings | GET | /api/v1/Listings/search | No |
| Book a Listing | POST | /api/v1/Bookings | JWT |
| Review a Listing | POST | /api/v1/Reviews | JWT |

---

## MCP Tools

### 1. `query_listings`
Search available short-term stay listings with required search filters.
- **Input:** `{ date_from, date_to, no_of_people, country, city, page?, page_size? }`
- **Output:** Paginated list of matching listings with title, location, city, country, capacity, and price

### 2. `book_listing`
Book a short-term stay listing.
- **Input:** `{ listing_id, from_date, to_date, guest_names[] }`
- **Output:** Booking confirmation with booking ID

### 3. `review_listing`
Submit a review for a completed stay.
- **Input:** `{ booking_id, rating (1-5), comment? }`
- **Output:** Review confirmation with review ID

---

## How to Run

### Prerequisites
- Node.js 18+
- Anthropic API Key

### 1. Clone the Repository
```bash
git clone https://github.com/bbgmfun/AI-Agent-Marketplace.git
cd AI-Agent-Marketplace
```

### 2. Setup Agent Backend
```bash
cd agent-backend
npm install
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
npm start
```

### 3. MCP Server Integration
```bash
cd mcp-server
npm install
# The agent backend starts this MCP server automatically over stdio.
# You do not need to run it manually during normal usage.
```

### 4. Setup Frontend
```bash
cd frontend
npm install
npm start
```

### 5. Open the Application
Navigate to `http://localhost:3000` in your browser.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| ANTHROPIC_API_KEY | Anthropic API key for Claude | (required) |
| API_BASE_URL | Midterm API base URL | https://stayapi-app.mangowater-b28dd996.swedencentral.azurecontainerapps.io |
| API_USERNAME | Guest username used for authenticated calls | se4458_listing_guest |
| API_PASSWORD | Login password for API auth | guest123 |
| API_ROLE | Role used if the guest account must be auto-registered | Guest |
| PORT | Agent backend port | 3001 |

---

## Technologies Used
- **React 18** - Frontend chat UI
- **Node.js + Express** - Agent backend server
- **Anthropic Claude API** - LLM for intent parsing and tool calling
- **@modelcontextprotocol/sdk** - MCP server implementation
- **react-markdown** - Rendering AI responses in chat
- **JWT** - API authentication

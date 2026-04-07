# SE4458 Assignment 2 - AI Agent Chat Application for Short-Term Stay Listings

## Student
**Begum Bal**

## Project Overview
An AI-powered chat application that allows users to interact with a Short-Term Stay booking platform through natural language. The AI agent can search listings, make bookings, and submit reviews on behalf of the user.

## Source Code
- **GitHub:** *(add your GitHub link here)*

## Demo Video
- **Video Link:** *(add OneDrive/Google Drive/YouTube link here)*

---

## Architecture

```
┌──────────────────┐     ┌─────────────────────┐     ┌─────────────┐
│  React Frontend  │────▶│  Agent Backend       │────▶│  MCP Server │
│  (Chat UI)       │◀────│  (Node.js + Claude)  │◀────│  (Node.js)  │
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
| Agent Backend | Node.js + Express | Receives messages, sends to Claude LLM with tools, executes tool calls |
| MCP Server | Node.js + @modelcontextprotocol/sdk | Exposes 3 tools (query_listings, book_listing, review_listing) |
| LLM | Claude (Anthropic API) | Parses user intent, decides which MCP tool to call, formats responses |
| API Gateway | Midterm REST API | Existing Short-Term Stay API with JWT auth |

### Flow
1. User sends a message through the React chat UI
2. Agent backend receives the message and forwards it to Claude with conversation history
3. Claude analyzes the user's intent and decides which tool to call
4. The tool call hits the API Gateway (midterm API) endpoint
5. API response flows back through Claude which formats a user-friendly reply
6. Response is displayed in the chat UI

---

## Design Decisions & Assumptions

### Design
- **Claude as LLM:** Used Anthropic's Claude API for superior tool-calling and natural language understanding
- **MCP Protocol:** Implemented a proper MCP server with stdio transport, following the Model Context Protocol standard
- **Agentic Loop:** The agent backend runs a loop allowing Claude to make multiple tool calls per user message if needed
- **Session Management:** Each chat session has isolated conversation history to maintain context
- **JWT Auth Caching:** Auth tokens are cached for 50 minutes (token lifetime is 60 min) to minimize login requests

### Assumptions
- The chat application uses a constant user (guest_id = 1) for authentication
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
| Login | POST | /api/v1/auth/login | No |
| Query Listings | GET | /api/v1/listings?page=N | No |
| Book a Listing | POST | /api/v1/bookings | JWT |
| Review a Listing | POST | /api/v1/reviews | JWT |

---

## MCP Tools

### 1. `query_listings`
Search available short-term stay listings with pagination.
- **Input:** `{ page?: number }`
- **Output:** List of listings with title, location, city, country, capacity, price_per_night

### 2. `book_listing`
Book a short-term stay listing.
- **Input:** `{ listing_id, guest_id, from_date, to_date, guest_count, guest_names? }`
- **Output:** Booking confirmation with booking details

### 3. `review_listing`
Submit a review for a completed stay.
- **Input:** `{ booking_id, listing_id, guest_id, rating (1-5), comment? }`
- **Output:** Review confirmation

---

## How to Run

### Prerequisites
- Node.js 18+
- Anthropic API Key

### 1. Clone the Repository
```bash
git clone <your-repo-url>
cd ai-agent-listing
```

### 2. Setup Agent Backend
```bash
cd agent-backend
npm install
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
npm start
```

### 3. Setup MCP Server (standalone, optional)
```bash
cd mcp-server
npm install
# The MCP server runs on stdio and is integrated into the agent backend
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
| API_EMAIL | Login email for API auth | guest@example.com |
| API_PASSWORD | Login password for API auth | guest123 |
| PORT | Agent backend port | 3001 |

---

## Technologies Used
- **React 18** - Frontend chat UI
- **Node.js + Express** - Agent backend server
- **Anthropic Claude API** - LLM for intent parsing and tool calling
- **@modelcontextprotocol/sdk** - MCP server implementation
- **react-markdown** - Rendering AI responses in chat
- **JWT** - API authentication

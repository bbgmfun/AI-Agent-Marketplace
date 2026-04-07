import React, { useEffect, useRef, useState } from "react";
import ChatMessage from "./components/ChatMessage";
import "./App.css";

const QUICK_ACTIONS = [
  {
    label: "Search stays",
    detail: "Query Listing",
    message: "Show me available listings",
  },
  {
    label: "Start booking",
    detail: "Book a Listing",
    message: "I would like to book a listing",
  },
  {
    label: "Write a review",
    detail: "Review a Listing",
    message: "I want to review a listing",
  },
];

const AGENT_BACKEND = process.env.REACT_APP_AGENT_URL || "http://localhost:3001";
const DEMO_LISTINGS = [
  {
    id: 101,
    title: "Charming Studio with Terrace",
    city: "Paris",
    country: "France",
    capacity: 2,
    pricePerNight: 120,
    rating: 4.9,
  },
  {
    id: 102,
    title: "Elegant Flat near the Eiffel Tower",
    city: "Paris",
    country: "France",
    capacity: 2,
    pricePerNight: 150,
    rating: 4.7,
  },
  {
    id: 201,
    title: "Sunny Apartment in Taksim",
    city: "Istanbul",
    country: "Turkey",
    capacity: 4,
    pricePerNight: 85,
    rating: 4.6,
  },
  {
    id: 202,
    title: "Modern Loft in Kadikoy",
    city: "Istanbul",
    country: "Turkey",
    capacity: 3,
    pricePerNight: 95,
    rating: 4.5,
  },
];

async function getApiErrorMessage(res) {
  try {
    const data = await res.json();
    return data?.error || null;
  } catch {
    return null;
  }
}

function classifyMessage(text) {
  const lower = text.toLowerCase();

  if (
    lower.includes("listing") &&
    ["show", "search", "find", "query", "available", "browse"].some((word) =>
      lower.includes(word)
    )
  ) {
    return "query";
  }

  if (["book", "reserve", "reservation"].some((word) => lower.includes(word))) {
    return "book";
  }

  if (["review", "rate", "feedback", "comment"].some((word) => lower.includes(word))) {
    return "review";
  }

  if (["detail", "more about", "tell me more"].some((word) => lower.includes(word))) {
    return "details";
  }

  return "default";
}

function buildQueryDemoResponse() {
  const lines = DEMO_LISTINGS.map(
    (listing) =>
      `- **${listing.title}**  \n  ID: \`${listing.id}\` | ${listing.city}, ${listing.country} | ${listing.capacity} guests | $${listing.pricePerNight}/night | Rating: ${listing.rating}`
  );

  return [
    "Demo mode is active, so these are sample listings rather than live API results.",
    "",
    "**Available listings**",
    ...lines,
    "",
    "To continue, you can say something like:",
    '- "Book listing 101 for 2 guests from 2026-06-05 to 2026-06-08"',
  ].join("\n");
}

function buildBookingDemoResponse() {
  return [
    "Demo mode booking preview:",
    "",
    "- Listing: **Charming Studio with Terrace**",
    "- Booking ID: `BK-98765432`",
    "- Status: **Confirmed**",
    "- Dates: `2026-06-05` to `2026-06-08`",
    "- Guests: `John Doe`, `Jane Doe`",
    "",
    "Live booking requires the backend to run with a valid Anthropic API key.",
  ].join("\n");
}

function buildReviewDemoResponse() {
  return [
    "Demo mode review preview:",
    "",
    "- Booking ID: `BK-98765432`",
    "- Rating: **5/5**",
    '- Comment: "Amazing stay with a great location."',
    "",
    "Live review submission requires the backend to run with a valid Anthropic API key.",
  ].join("\n");
}

function buildDetailsDemoResponse(text) {
  const lower = text.toLowerCase();
  const listing =
    DEMO_LISTINGS.find((item) => lower.includes(item.title.toLowerCase())) || DEMO_LISTINGS[0];

  return [
    `**${listing.title}**`,
    "",
    `- Listing ID: \`${listing.id}\``,
    `- Location: ${listing.city}, ${listing.country}`,
    `- Capacity: ${listing.capacity} guests`,
    `- Price: $${listing.pricePerNight}/night`,
    `- Rating: ${listing.rating}`,
    "",
    "This is a demo description shown because live AI mode is unavailable right now.",
  ].join("\n");
}

function buildDefaultDemoResponse() {
  return [
    "I can help with these demo actions:",
    "",
    "- **Query Listings**: ask for available places",
    "- **Book a Listing**: ask to make a reservation",
    "- **Review a Listing**: ask to submit feedback",
    "",
    "Example: `Show me available listings in Istanbul for 2 guests`",
  ].join("\n");
}

function buildDemoResponse(text) {
  switch (classifyMessage(text)) {
    case "query":
      return buildQueryDemoResponse();
    case "book":
      return buildBookingDemoResponse();
    case "review":
      return buildReviewDemoResponse();
    case "details":
      return buildDetailsDemoResponse(text);
    default:
      return buildDefaultDemoResponse();
  }
}

function isLiveLlmConfigError(message) {
  return /anthropic|api key|x-api-key|ollama|no live llm|tool-calling steps/i.test(message);
}

function App() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Describe the stay you need and I can help you search, book, or review a listing.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => "session-" + Date.now());
  const [mode, setMode] = useState("checking");
  const [bannerMessage, setBannerMessage] = useState("Checking backend status...");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    async function checkBackend() {
      try {
        const res = await fetch(`${AGENT_BACKEND}/api/health`);
        if (!res.ok) throw new Error(`Health check failed: ${res.status}`);

        const data = await res.json();
        if (cancelled) return;

        if (data.liveReady) {
          setMode("live");
          setBannerMessage(
            `Connected to live AI backend${data.activeProvider ? ` (${data.activeProvider})` : ""}.`
          );
          return;
        }

        setMode("demo");
        if (data.ollamaAvailable && !data.ollamaModelReady) {
          setBannerMessage(
            `Demo mode: Ollama is running, but model '${data.ollamaModel}' is not installed yet.`
          );
          return;
        }

        setBannerMessage("Demo mode: no live LLM is configured on the backend.");
      } catch (_) {
        if (cancelled) return;
        setMode("demo");
        setBannerMessage("Demo mode: agent backend is unavailable.");
      }
    }

    checkBackend();
    intervalId = window.setInterval(checkBackend, 3000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  const addAssistantMessage = (content, options = {}) => {
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content,
        ...options,
      },
    ]);
  };

  const sendDemoMessage = async (text) => {
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    addAssistantMessage(buildDemoResponse(text));
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    const userMsg = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      if (mode !== "live") {
        await sendDemoMessage(text);
        return;
      }

      const res = await fetch(`${AGENT_BACKEND}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });

      if (!res.ok) {
        const apiError = await getApiErrorMessage(res);
        throw new Error(apiError || `Server error: ${res.status}`);
      }

      const data = await res.json();
      addAssistantMessage(data.response);
    } catch (err) {
      if (isLiveLlmConfigError(err.message)) {
        setMode("demo");
        setBannerMessage(
          "Demo mode: live AI is unavailable because no local or remote LLM is ready."
        );
        await sendDemoMessage(text);
        return;
      }

      addAssistantMessage(`Sorry, something went wrong: ${err.message}`, {
        isError: true,
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const clearChat = async () => {
    if (mode === "live") {
      try {
        await fetch(`${AGENT_BACKEND}/api/chat/clear`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
      } catch (_) {}
    }

    setMessages([
      {
        role: "assistant",
        content: "Describe the stay you need and I can help you search, book, or review a listing.",
      },
    ]);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div className="brand-mark" aria-hidden="true">
            <span></span>
          </div>
          <div className="header-copy">
            <span className="eyebrow">Listing Agent</span>
            <h1>Short-term stays, handled in chat</h1>
          </div>
        </div>
        <div className="header-actions">
          <div className={`status-pill ${mode}`}>{mode === "live" ? "Live" : mode === "demo" ? "Demo" : "Checking"}</div>
          <button className="clear-btn" onClick={clearChat} title="Clear chat">
            New chat
          </button>
        </div>
      </header>

      <div className={`mode-banner ${mode}`}>
        {bannerMessage}
      </div>

      <div className="chat-container">
        <div className="messages">
          {messages.map((msg, i) => (
            <ChatMessage key={i} message={msg} />
          ))}

          {loading && (
            <div className="message assistant">
              <div className="avatar assistant-avatar">AI</div>
              <div className="bubble assistant-bubble">
                <div className="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {messages.length === 1 && (
          <div className="quick-actions">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                className="quick-action-btn"
                onClick={() => sendMessage(action.message)}
                disabled={loading}
              >
                <span className="qa-label">{action.label}</span>
                <span className="qa-detail">{action.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <form className="input-bar" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask to search, book, or review a listing"
          disabled={loading}
          autoFocus
        />
        <button type="submit" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

export default App;

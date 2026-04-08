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
const DEMO_CITIES = [...new Set(DEMO_LISTINGS.map((listing) => listing.city))];
const DEMO_COUNTRIES = [...new Set(DEMO_LISTINGS.map((listing) => listing.country))];
const QUERY_KEYWORDS = [
  "show",
  "search",
  "find",
  "query",
  "available",
  "browse",
  "listele",
  "ara",
  "bul",
  "musait",
  "uygun",
  "goster",
];
const BOOK_KEYWORDS = [
  "book",
  "reserve",
  "reservation",
  "rezervasyon",
  "rezerv",
  "ayirt",
  "ayir",
  "kirala",
];
const REVIEW_KEYWORDS = [
  "review",
  "rate",
  "feedback",
  "comment",
  "yorum",
  "degerlendir",
  "puanla",
  "puan",
];
const DETAILS_KEYWORDS = ["detail", "more about", "tell me more", "detay", "ayrinti"];
const INITIAL_DEMO_STATE = {
  lastQuery: null,
  lastBooking: null,
  lastReview: null,
};

function normalizeText(value) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getLastKeywordIndex(text, keywords) {
  return keywords.reduce((max, keyword) => Math.max(max, text.lastIndexOf(keyword)), -1);
}

async function getApiErrorMessage(res) {
  try {
    const data = await res.json();
    return data?.error || null;
  } catch {
    return null;
  }
}

function classifyMessage(text) {
  const lower = normalizeText(text);
  const candidates = [];
  const priority = { review: 4, book: 3, query: 2, details: 1 };
  const hasListingContext = [
    "listing",
    "listings",
    "stay",
    "stays",
    "place",
    "places",
    "ilan",
    "ev",
    "konaklama",
  ].some((word) => lower.includes(word));

  const queryIndex = getLastKeywordIndex(lower, QUERY_KEYWORDS);
  if (
    queryIndex >= 0 &&
    (hasListingContext || /\b(paris|istanbul|france|turkey|\d+\s+(guest|guests|kisi))\b/.test(lower))
  ) {
    candidates.push({ intent: "query", index: queryIndex });
  }

  const bookIndex = getLastKeywordIndex(lower, BOOK_KEYWORDS);
  if (bookIndex >= 0) {
    candidates.push({ intent: "book", index: bookIndex });
  }

  const reviewIndex = getLastKeywordIndex(lower, REVIEW_KEYWORDS);
  if (reviewIndex >= 0) {
    candidates.push({ intent: "review", index: reviewIndex });
  }

  const detailsIndex = getLastKeywordIndex(lower, DETAILS_KEYWORDS);
  if (detailsIndex >= 0) {
    candidates.push({ intent: "details", index: detailsIndex });
  }

  if (candidates.length === 0) {
    return "default";
  }

  candidates.sort(
    (a, b) => b.index - a.index || priority[b.intent] - priority[a.intent]
  );

  return candidates[0].intent;
}

function findDemoLocationMatch(text, values) {
  const lower = normalizeText(text);
  return values.find((value) => lower.includes(normalizeText(value))) || null;
}

function extractDemoGuestCount(text) {
  const normalized = normalizeText(text);
  const guestMatch =
    normalized.match(/\bfor\s+(\d+)\s+(?:guest|guests|people|persons|kisi)\b/i) ||
    normalized.match(/\b(\d+)\s+(?:guest|guests|people|persons|kisi)\b/i);

  return guestMatch ? Number.parseInt(guestMatch[1], 10) : null;
}

function extractDemoDates(text) {
  const dates = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
  return {
    fromDate: dates[0] || null,
    toDate: dates[1] || null,
  };
}

function extractDemoListingId(text) {
  const match =
    text.match(/\blisting\s*(?:id)?\s*#?\s*(\d+)\b/i) ||
    text.match(/\bilan\s*(?:id)?\s*#?\s*(\d+)\b/i) ||
    text.match(/\bid\s*[:#]?\s*(\d+)\b/i);

  return match ? Number.parseInt(match[1], 10) : null;
}

function extractDemoBookingId(text) {
  const match =
    text.match(/\bBK-\d+\b/i) ||
    text.match(/\bbooking\s*(?:id)?\s*[:#]?\s*(\d+)\b/i);

  if (!match) return null;
  return match[0].toUpperCase().startsWith("BK-") ? match[0].toUpperCase() : `BK-${match[1]}`;
}

function splitDemoGuestNames(raw) {
  return raw
    .split(/\s*(?:,| and | & | ile | ve )\s*/i)
    .map((name) => name.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\.$/, ""))
    .filter(Boolean)
    .filter((name) => {
      const normalized = normalizeText(name);
      return (
        /[a-z]/i.test(name) &&
        !/^(guest|guests|people|persons|kisi|kisiler|\d+)$/i.test(normalized) &&
        !/^\d+\s*(guest|guests|people|persons|kisi|kisiler)$/i.test(normalized) &&
        !/^(from|between)\b/i.test(normalized)
      );
    });
}

function extractDemoGuestNames(text) {
  const patterns = [
    /guest names?\s*[:\-]\s*(.+)$/i,
    /guests?\s*[:\-]\s*(.+)$/i,
    /isim(?:ler[iı])?\s*[:\-]\s*(.+)$/i,
    /\bfor\s+(.+?)\s+(?:from|between|check-?in|\d{4}-\d{2}-\d{2}|$)/i,
    /\bad[ıi]na\s+(.+?)\s+(?:i[cç]in|from|\d{4}-\d{2}-\d{2}|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const names = splitDemoGuestNames(match[1]);
    if (names.length > 0) return names;
  }

  return [];
}

function extractDemoRating(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/\b([1-5])(?:\s*\/\s*5|\s*(?:star|stars|yildiz|puan))?\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function extractDemoComment(text) {
  const quotedMatch = text.match(/["“](.+?)["”]/);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const patterns = [
    /(?:comment|feedback|yorum)\s*[:\-]?\s*(.+)$/i,
    /\bbecause\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function extractDemoQueryFilters(text) {
  const { fromDate, toDate } = extractDemoDates(text);
  return {
    city: findDemoLocationMatch(text, DEMO_CITIES),
    country: findDemoLocationMatch(text, DEMO_COUNTRIES),
    guests: extractDemoGuestCount(text),
    fromDate,
    toDate,
  };
}

function filterDemoListings(text) {
  const filters = extractDemoQueryFilters(text);
  const listings = DEMO_LISTINGS.filter((listing) => {
    if (filters.city && listing.city.toLowerCase() !== filters.city.toLowerCase()) {
      return false;
    }

    if (filters.country && listing.country.toLowerCase() !== filters.country.toLowerCase()) {
      return false;
    }

    if (filters.guests && listing.capacity < filters.guests) {
      return false;
    }

    return true;
  });

  return { filters, listings };
}

function formatDemoQueryFilters(filters) {
  const parts = [];

  if (filters.city) parts.push(`city: ${filters.city}`);
  if (filters.country) parts.push(`country: ${filters.country}`);
  if (filters.guests) parts.push(`guests: ${filters.guests}`);
  if (filters.fromDate) parts.push(`check-in: ${filters.fromDate}`);
  if (filters.toDate) parts.push(`check-out: ${filters.toDate}`);

  return parts.length > 0 ? parts.join(" | ") : null;
}

function buildQueryDemoResponse(text, demoState) {
  const { filters, listings } = filterDemoListings(text);
  const appliedFilters = formatDemoQueryFilters(filters);
  const lines = listings.map(
    (listing) =>
      `- **${listing.title}**  \n  ID: \`${listing.id}\` | ${listing.city}, ${listing.country} | ${listing.capacity} guests | $${listing.pricePerNight}/night | Rating: ${listing.rating}`
  );

  if (lines.length === 0) {
    return {
      content: [
        "Demo mode is active, so these are sample listings rather than live API results.",
        appliedFilters ? `Applied filters: ${appliedFilters}` : null,
        "",
        "I couldn't find a sample listing that matches this search.",
        "Try changing the city or the guest count.",
      ]
        .filter(Boolean)
        .join("\n"),
      nextState: {
        ...demoState,
        lastQuery: { filters, listings: [] },
      },
    };
  }

  return {
    content: [
      "Demo mode is active, so these are sample listings rather than live API results.",
      appliedFilters ? `Applied filters: ${appliedFilters}` : null,
      "",
      "**Available listings**",
      ...lines,
      "",
      "To continue, you can say something like:",
      `- "Book listing ${listings[0].id} for Begum Bal from 2026-06-05 to 2026-06-08"`,
    ]
      .filter(Boolean)
      .join("\n"),
    nextState: {
      ...demoState,
      lastQuery: { filters, listings },
    },
  };
}

function resolveDemoListing(text, demoState) {
  const listingId = extractDemoListingId(text);
  if (listingId) {
    return (
      DEMO_LISTINGS.find((listing) => listing.id === listingId) ||
      demoState.lastQuery?.listings?.[0] ||
      DEMO_LISTINGS[0]
    );
  }

  const normalized = normalizeText(text);
  if (demoState.lastQuery?.listings?.length) {
    if (/\b(first|1st|ilk)\b/i.test(normalized)) return demoState.lastQuery.listings[0];
    if (/\b(second|2nd|ikinci)\b/i.test(normalized)) {
      return demoState.lastQuery.listings[1] || demoState.lastQuery.listings[0];
    }
    return demoState.lastQuery.listings[0];
  }

  return DEMO_LISTINGS[0];
}

function buildBookingDemoResponse(text, demoState) {
  const listing = resolveDemoListing(text, demoState);
  const { fromDate, toDate } = extractDemoDates(text);
  const guestNames = extractDemoGuestNames(text);
  const booking = {
    bookingId: `BK-${Date.now().toString().slice(-8)}`,
    listing,
    fromDate: fromDate || demoState.lastQuery?.filters?.fromDate || "2026-06-05",
    toDate: toDate || demoState.lastQuery?.filters?.toDate || "2026-06-08",
    guestNames: guestNames.length > 0 ? guestNames : ["Guest name missing"],
  };

  return {
    content: [
      "Demo mode booking preview:",
      "",
      `- Listing: **${booking.listing.title}**`,
      `- Booking ID: \`${booking.bookingId}\``,
      "- Status: **Confirmed**",
      `- Dates: \`${booking.fromDate}\` to \`${booking.toDate}\``,
      `- Guests: ${booking.guestNames.map((name) => `\`${name}\``).join(", ")}`,
      "",
      guestNames.length === 0
        ? "I could not detect the guest names from your message, so I kept a placeholder. Include the names explicitly to see them here in demo mode."
        : "Guest names were taken from your message so the preview matches your booking request.",
      "Live booking requires the backend to run with a valid Anthropic API key.",
    ].join("\n"),
    nextState: {
      ...demoState,
      lastBooking: booking,
    },
  };
}

function buildReviewDemoResponse(text, demoState) {
  const requestedBookingId = extractDemoBookingId(text);
  const booking =
    (requestedBookingId &&
      demoState.lastBooking?.bookingId === requestedBookingId &&
      demoState.lastBooking) ||
    demoState.lastBooking;

  if (!booking && !requestedBookingId) {
    return {
      content: [
        "Demo mode review preview needs a booking first.",
        "",
        "Book a listing in this chat or include a booking ID such as `BK-12345678` in your message.",
      ].join("\n"),
      nextState: demoState,
    };
  }

  const rating = extractDemoRating(text) || 5;
  const comment = extractDemoComment(text) || "Amazing stay with a great location.";
  const activeBookingId = requestedBookingId || booking?.bookingId || "BK-98765432";
  const activeListingTitle = booking?.listing?.title || "Charming Studio with Terrace";
  const review = {
    bookingId: activeBookingId,
    listingTitle: activeListingTitle,
    rating,
    comment,
    reviewId: `RV-${Date.now().toString().slice(-8)}`,
  };

  return {
    content: [
      "Demo mode review preview:",
      "",
      `- Booking ID: \`${review.bookingId}\``,
      `- Listing: **${review.listingTitle}**`,
      `- Rating: **${review.rating}/5**`,
      `- Comment: "${review.comment}"`,
      `- Review ID: \`${review.reviewId}\``,
      "",
      booking
        ? "The review used the latest booking in this chat, so you do not need to repeat the booking ID every time in demo mode."
        : "The review used the booking ID from your message.",
      "Live review submission requires the backend to run with a valid Anthropic API key.",
    ].join("\n"),
    nextState: {
      ...demoState,
      lastReview: review,
    },
  };
}

function buildDetailsDemoResponse(text, demoState) {
  const lower = normalizeText(text);
  const listing =
    DEMO_LISTINGS.find((item) => lower.includes(normalizeText(item.title))) || DEMO_LISTINGS[0];

  return {
    content: [
      `**${listing.title}**`,
      "",
      `- Listing ID: \`${listing.id}\``,
      `- Location: ${listing.city}, ${listing.country}`,
      `- Capacity: ${listing.capacity} guests`,
      `- Price: $${listing.pricePerNight}/night`,
      `- Rating: ${listing.rating}`,
      "",
      "This is a demo description shown because live AI mode is unavailable right now.",
    ].join("\n"),
    nextState: demoState,
  };
}

function buildDefaultDemoResponse(demoState) {
  return {
    content: [
      "I can help with these demo actions:",
      "",
      "- **Query Listings**: ask for available places",
      "- **Book a Listing**: ask to make a reservation",
      "- **Review a Listing**: ask to submit feedback",
      "",
      "Examples:",
      "- `Show me available listings in Istanbul for 2 guests`",
      "- `Book listing 201 for Begum Bal from 2026-06-05 to 2026-06-08`",
      "- `Review my last booking with 5 stars and comment: Great stay`",
    ].join("\n"),
    nextState: demoState,
  };
}

function buildDemoResponse(text, demoState) {
  switch (classifyMessage(text)) {
    case "query":
      return buildQueryDemoResponse(text, demoState);
    case "book":
      return buildBookingDemoResponse(text, demoState);
    case "review":
      return buildReviewDemoResponse(text, demoState);
    case "details":
      return buildDetailsDemoResponse(text, demoState);
    default:
      return buildDefaultDemoResponse(demoState);
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
  const [demoState, setDemoState] = useState(INITIAL_DEMO_STATE);
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
    const { content, nextState } = buildDemoResponse(text, demoState);
    setDemoState(nextState);
    addAssistantMessage(content);
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
    setDemoState(INITIAL_DEMO_STATE);
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

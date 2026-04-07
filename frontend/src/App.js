import React, { useState, useRef, useEffect } from "react";
import ChatMessage from "./components/ChatMessage";
import "./App.css";

const QUICK_ACTIONS = [
  { label: "Query Listing", icon: "🔍", message: "Show me available listings" },
  { label: "Book a Listing", icon: "⭐", message: "I would like to book a listing" },
  { label: "Review a Listing", icon: "📝", message: "I want to review a listing" },
];

const AGENT_BACKEND = process.env.REACT_APP_AGENT_URL || "http://localhost:3001";

function App() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hello! How can I assist you today?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => "session-" + Date.now());
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    const userMsg = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${AGENT_BACKEND}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, something went wrong: ${err.message}`,
          isError: true,
        },
      ]);
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
    try {
      await fetch(`${AGENT_BACKEND}/api/chat/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch (_) {}
    setMessages([
      { role: "assistant", content: "Hello! How can I assist you today?" },
    ]);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="header-icon">🏠</span>
          <h1>AI Agent - Listing Actions</h1>
        </div>
        <button className="clear-btn" onClick={clearChat} title="Clear chat">
          🗑️ Clear
        </button>
      </header>

      <div className="chat-container">
        <div className="messages">
          {messages.map((msg, i) => (
            <ChatMessage key={i} message={msg} />
          ))}

          {loading && (
            <div className="message assistant">
              <div className="avatar assistant-avatar">🤖</div>
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
                <span className="qa-icon">{action.icon}</span>
                <span>{action.label}</span>
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
          placeholder="What can I assist you with?"
          disabled={loading}
          autoFocus
        />
        <button type="submit" disabled={loading || !input.trim()}>
          ➤
        </button>
      </form>
    </div>
  );
}

export default App;

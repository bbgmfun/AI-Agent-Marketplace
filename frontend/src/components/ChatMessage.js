import React from "react";
import ReactMarkdown from "react-markdown";

function ChatMessage({ message }) {
  const isUser = message.role === "user";

  return (
    <div className={`message ${isUser ? "user" : "assistant"}`}>
      <div className={`avatar ${isUser ? "user-avatar" : "assistant-avatar"}`}>
        {isUser ? "👤" : "🤖"}
      </div>
      <div
        className={`bubble ${isUser ? "user-bubble" : "assistant-bubble"} ${
          message.isError ? "error-bubble" : ""
        }`}
      >
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <ReactMarkdown
            components={{
              // Custom renderers for better display
              table: ({ children }) => (
                <div className="table-wrapper">
                  <table>{children}</table>
                </div>
              ),
              code: ({ inline, children, ...props }) => {
                if (inline) {
                  return <code className="inline-code" {...props}>{children}</code>;
                }
                return (
                  <pre className="code-block">
                    <code {...props}>{children}</code>
                  </pre>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}

export default ChatMessage;

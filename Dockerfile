FROM node:18-alpine

WORKDIR /app

# Copy MCP server
COPY mcp-server/package*.json ./mcp-server/
RUN cd mcp-server && npm install --production

# Copy agent backend
COPY agent-backend/package*.json ./agent-backend/
RUN cd agent-backend && npm install --production

# Copy frontend build (pre-built)
COPY frontend/build ./frontend/build

# Copy source files
COPY mcp-server/ ./mcp-server/
COPY agent-backend/ ./agent-backend/

# Agent backend serves both API and static frontend
WORKDIR /app/agent-backend

EXPOSE 3001

CMD ["node", "server.js"]

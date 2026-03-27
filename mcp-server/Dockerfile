FROM node:24-alpine

# node-pty requires native compilation tools
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Build from repo root: docker build -t langwatch-mcp -f mcp-server/Dockerfile .
COPY mcp-server/package.json mcp-server/pnpm-lock.yaml mcp-server/pnpm-workspace.yaml ./mcp-server/
WORKDIR /app/mcp-server
RUN pnpm install --frozen-lockfile

WORKDIR /app
COPY mcp-server/ ./mcp-server/
COPY langevals/ ./langevals/

EXPOSE 3000

WORKDIR /app/mcp-server
CMD ["node", "--import", "tsx/esm", "src/index.ts", "--http", "--port", "3000"]

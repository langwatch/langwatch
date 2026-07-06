FROM node:24-alpine

# node-pty requires native compilation tools
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@10 --activate
# node-pty ships no linux prebuild and compiles via node-gyp (not on PATH under
# Node-24 + npm-11); the mcp-server install closure includes it.
RUN npm install -g node-gyp

WORKDIR /app

# Build from repo root: docker build -t langwatch-mcp -f mcp-server/Dockerfile .
# The repo is ONE pnpm workspace, so install runs against the root lockfile.
# All member manifests must be present for a --frozen-lockfile check, but
# --filter installs only mcp-server's dependency closure to keep the image lean.
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc package.json ./
COPY packages/server/package.json ./packages/server/
COPY langwatch/package.json ./langwatch/
COPY langwatch/vendor ./langwatch/vendor
COPY mcp-server/package.json ./mcp-server/
COPY skills/package.json ./skills/
COPY typescript-sdk/package.json ./typescript-sdk/
COPY typescript-sdk/examples ./typescript-sdk/examples
COPY bullboard/package.json ./bullboard/
COPY agentic-e2e-tests/package.json ./agentic-e2e-tests/
RUN pnpm install --frozen-lockfile --filter @langwatch/mcp-server...

COPY mcp-server/ ./mcp-server/
COPY langevals/ ./langevals/

EXPOSE 3000

WORKDIR /app/mcp-server
CMD ["node", "--import", "tsx/esm", "src/index.ts", "--http", "--port", "3000"]

FROM node:24-alpine

# node-pty requires native compilation tools
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Build from repo root: docker build -t langwatch-mcp -f mcp-server/Dockerfile .
#
# Since ADR-076 the repo is a SINGLE pnpm workspace, so the lockfile and
# workspace definition live at the root and the install runs from there,
# narrowed to this package and its workspace dependencies.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY mcp-server/package.json ./mcp-server/
COPY packages/handled-error ./packages/handled-error
# Manifests only. `--frozen-lockfile` checks the lockfile against every
# workspace member it can see, so each member needs at least its package.json.
COPY langwatch/package.json ./langwatch/
COPY langwatch/packages/redaction/package.json ./langwatch/packages/redaction/
COPY langwatch/packages/ssrf/package.json ./langwatch/packages/ssrf/
COPY langwatch/packages/api/package.json ./langwatch/packages/api/
COPY langwatch/packages/automations/package.json ./langwatch/packages/automations/
COPY langwatch/packages/observability/package.json ./langwatch/packages/observability/
COPY langwatch/packages/react-rum/package.json ./langwatch/packages/react-rum/
COPY packages/langy/package.json ./packages/langy/
COPY packages/server/package.json ./packages/server/
COPY typescript-sdk/package.json ./typescript-sdk/
COPY skills/package.json ./skills/
COPY agentic-e2e-tests/package.json ./agentic-e2e-tests/
RUN pnpm install --frozen-lockfile --filter "@langwatch/mcp-server..."

# The redaction and ssrf sources the MCP server imports, copied after the
# install so a source edit does not invalidate the dependency layer.
COPY langwatch/packages/redaction ./langwatch/packages/redaction
COPY langwatch/packages/ssrf ./langwatch/packages/ssrf

WORKDIR /app
COPY mcp-server/ ./mcp-server/
COPY langevals/ ./langevals/

EXPOSE 3000

WORKDIR /app/mcp-server
CMD ["node", "--import", "tsx/esm", "src/index.ts", "--http", "--port", "3000"]

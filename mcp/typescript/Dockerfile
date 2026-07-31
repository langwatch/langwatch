FROM node:24-alpine

# node-pty requires native compilation tools
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Build from repo root: docker build -t langwatch-mcp -f mcp/typescript/Dockerfile .
#
# Since ADR-076 the repo is a SINGLE pnpm workspace, so the lockfile and
# workspace definition live at the root and the install runs from there,
# narrowed to this package and its workspace dependencies.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY mcp/typescript/package.json ./mcp/typescript/
COPY packages/handled-error ./packages/handled-error
# Manifests only. `--frozen-lockfile` checks the lockfile against every
# workspace member it can see, so each member needs at least its package.json.
COPY platform/app/package.json ./platform/app/
COPY packages/redaction/package.json ./packages/redaction/
COPY packages/ssrf/package.json ./packages/ssrf/
COPY packages/api/package.json ./packages/api/
COPY packages/automations/package.json ./packages/automations/
COPY packages/observability/package.json ./packages/observability/
COPY packages/react-rum/package.json ./packages/react-rum/
COPY packages/langy/package.json ./packages/langy/
COPY packages/server/package.json ./packages/server/
COPY sdks/typescript/package.json ./sdks/typescript/
COPY skills/package.json ./skills/
COPY dev/tests/agentic-e2e/package.json ./dev/tests/agentic-e2e/
RUN pnpm install --frozen-lockfile --filter "@langwatch/mcp-server..."

# The redaction and ssrf sources the MCP server imports, copied after the
# install so a source edit does not invalidate the dependency layer.
COPY packages/redaction ./packages/redaction
COPY packages/ssrf ./packages/ssrf

WORKDIR /app
COPY mcp/typescript/ ./mcp/typescript/
COPY services/langevals/ ./services/langevals/

EXPOSE 3000

WORKDIR /app/mcp/typescript
CMD ["node", "--import", "tsx/esm", "src/index.ts", "--http", "--port", "3000"]

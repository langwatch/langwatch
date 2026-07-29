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
COPY platform/app/packages/redaction/package.json ./platform/app/packages/redaction/
COPY platform/app/packages/ssrf/package.json ./platform/app/packages/ssrf/
COPY platform/app/packages/api/package.json ./platform/app/packages/api/
COPY platform/app/packages/automations/package.json ./platform/app/packages/automations/
COPY platform/app/packages/observability/package.json ./platform/app/packages/observability/
COPY platform/app/packages/react-rum/package.json ./platform/app/packages/react-rum/
COPY packages/langy/package.json ./packages/langy/
COPY packages/server/package.json ./packages/server/
COPY sdks/typescript/package.json ./sdks/typescript/
COPY skills/package.json ./skills/
COPY tests/agentic-e2e/package.json ./tests/agentic-e2e/
RUN pnpm install --frozen-lockfile --filter "@langwatch/mcp-server..."

# The redaction and ssrf sources the MCP server imports, copied after the
# install so a source edit does not invalidate the dependency layer.
COPY platform/app/packages/redaction ./platform/app/packages/redaction
COPY platform/app/packages/ssrf ./platform/app/packages/ssrf

WORKDIR /app
COPY mcp/typescript/ ./mcp/typescript/
COPY services/langevals/ ./services/langevals/

EXPOSE 3000

WORKDIR /app/mcp/typescript
CMD ["node", "--import", "tsx/esm", "src/index.ts", "--http", "--port", "3000"]

# ── Stage 1: build ──────────────────────────────────────────────────
FROM node:24-alpine AS builder
RUN apk --no-cache add curl python3 make gcc g++ openssl bash
RUN npm install -g pnpm@10.24.0

# Install Goose migration tool (copied to runtime stage later)
ARG GOOSE_SHA256_ARM64=dfafe0254b0058cabf016234a500df5ada1623ed034e9473cee9fe4ed07ca090
ARG GOOSE_SHA256_X86_64=8b3eee9845cd87d827ba1abddb85235fb3684f9fb1666426f647ddd12fd29efe
RUN ARCH=$(uname -m) && \
  if [ "$ARCH" = "aarch64" ]; then \
  GOOSE_URL="https://github.com/pressly/goose/releases/download/v3.26.0/goose_linux_arm64"; \
  GOOSE_SHA256="$GOOSE_SHA256_ARM64"; \
  elif [ "$ARCH" = "x86_64" ]; then \
  GOOSE_URL="https://github.com/pressly/goose/releases/download/v3.26.0/goose_linux_x86_64"; \
  GOOSE_SHA256="$GOOSE_SHA256_X86_64"; \
  else \
  echo "Unsupported architecture: $ARCH" && exit 1; \
  fi && \
  curl -fsSL "$GOOSE_URL" -o /tmp/goose && \
  echo "$GOOSE_SHA256  /tmp/goose" | sha256sum -c - || (rm -f /tmp/goose && exit 1) && \
  mv /tmp/goose /usr/local/bin/goose && \
  chmod +x /usr/local/bin/goose

WORKDIR /app

# Skip Prisma checksum verification for air-gapped builds
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

# mcp/typescript is a workspace member — copy it early so pnpm install can link it.
# Its build runs automatically as part of the app's `pnpm run build`
# (via start:prepare:files → build:mcp-server).
COPY mcp/typescript ./mcp/typescript
COPY services/langevals/ts-integration/evaluators.generated.ts ./services/langevals/ts-integration/evaluators.generated.ts
COPY packages ./packages
COPY skills ./skills
COPY infra/docker/Dockerfile.langyagent ./infra/docker/Dockerfile.langyagent
COPY feature-map.json ./feature-map.json

COPY platform/app/package.json platform/app/pnpm-lock.yaml platform/app/pnpm-workspace.yaml ./platform/app/
# The `packages/*` workspace members (e.g. @langwatch/observability, @langwatch/api)
# are consumed as source, so pnpm install must see their package.json to link them
# and install their own dependencies (pino, pino-pretty, ...) into
# packages/*/node_modules. Without this the app bundle build fails to resolve those
# deps (e.g. "Rolldown failed to resolve import 'pino'"). Same reason mcp-server is
# copied early above. node_modules is dockerignored, so only source is copied here.
COPY platform/app/packages ./platform/app/packages
COPY platform/app/vendor ./platform/app/vendor
# https://stackoverflow.com/questions/70154568/pnpm-equivalent-command-for-npm-ci
RUN cd platform/app && CI=true pnpm install --frozen-lockfile
COPY platform/app ./platform/app
RUN cd platform/app && NODE_OPTIONS=--max-old-space-size=4096 pnpm run build

# Remove dev dependencies — not needed at runtime
RUN cd platform/app && CI=true pnpm prune --prod
# Regenerate Prisma client after pruning (prisma is a prod dep, but generate needs re-run)
RUN cd platform/app && pnpm prisma generate

# ── Stage 2: runtime ───────────────────────────────────────────────
FROM node:24-alpine
RUN apk --no-cache add curl openssl bash
RUN npm install -g pnpm@10.24.0

COPY --from=builder /usr/local/bin/goose /usr/local/bin/goose

WORKDIR /app

# Copy built artifacts from builder.
# mcp/typescript must be copied alongside platform/app because pnpm workspace
# symlinks platform/app/node_modules/@langwatch/mcp-server -> the mcp/typescript tree.
# cli-cards is another root workspace package linked the same way and is loaded
# by migration tasks as well as the running server.
COPY --from=builder /app/platform/app ./platform/app
COPY --from=builder /app/mcp/typescript ./mcp/typescript
COPY --from=builder /app/packages/cli-cards/package.json ./packages/cli-cards/package.json
COPY --from=builder /app/packages/cli-cards/src ./packages/cli-cards/src
# cli-cards deliberately declares zod as a peer. Because the workspace package
# lives outside /app/platform/app, expose the app's production zod at the nearest
# shared node_modules boundary after dev dependencies have been pruned.
RUN mkdir -p ./node_modules && ln -s ../platform/app/node_modules/zod ./node_modules/zod
COPY --from=builder /app/services/langevals/ts-integration/evaluators.generated.ts ./services/langevals/ts-integration/evaluators.generated.ts
COPY --from=builder /app/feature-map.json ./feature-map.json

ENV NODE_ENV=production
EXPOSE 5560

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD cd platform/app && pnpm start

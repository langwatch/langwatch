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

# mcp-server is a workspace member — copy it early so pnpm install can link it.
# Its build runs automatically as part of langwatch's `pnpm run build`
# (via start:prepare:files → build:mcp-server).
COPY mcp-server ./mcp-server
COPY langevals/ts-integration/evaluators.generated.ts ./langevals/ts-integration/evaluators.generated.ts
COPY packages ./packages
COPY skills ./skills
COPY Dockerfile.langyagent ./Dockerfile.langyagent
COPY feature-map.json ./feature-map.json

COPY langwatch/package.json langwatch/pnpm-lock.yaml langwatch/pnpm-workspace.yaml ./langwatch/
# The `packages/*` workspace members (e.g. @langwatch/observability, @langwatch/api)
# are consumed as source, so pnpm install must see their package.json to link them
# and install their own dependencies (pino, pino-pretty, ...) into
# packages/*/node_modules. Without this the app bundle build fails to resolve those
# deps (e.g. "Rolldown failed to resolve import 'pino'"). Same reason mcp-server is
# copied early above. node_modules is dockerignored, so only source is copied here.
COPY langwatch/packages ./langwatch/packages
COPY langwatch/vendor ./langwatch/vendor
# https://stackoverflow.com/questions/70154568/pnpm-equivalent-command-for-npm-ci
RUN cd langwatch && CI=true pnpm install --frozen-lockfile
COPY langwatch ./langwatch
RUN cd langwatch && NODE_OPTIONS=--max-old-space-size=4096 pnpm run build

# Remove dev dependencies — not needed at runtime
RUN cd langwatch && CI=true pnpm prune --prod
# Regenerate Prisma client after pruning (prisma is a prod dep, but generate needs re-run)
RUN cd langwatch && pnpm prisma generate

# ── Stage 2: runtime ───────────────────────────────────────────────
FROM node:24-alpine
RUN apk --no-cache add curl openssl bash
RUN npm install -g pnpm@10.24.0

COPY --from=builder /usr/local/bin/goose /usr/local/bin/goose

WORKDIR /app

# Copy built artifacts from builder.
# mcp-server must be copied alongside langwatch because pnpm workspace
# symlinks langwatch/node_modules/@langwatch/mcp-server -> ../../../mcp-server.
# cli-cards is another root workspace package linked the same way and is loaded
# by migration tasks as well as the running server.
COPY --from=builder /app/langwatch ./langwatch
COPY --from=builder /app/mcp-server ./mcp-server
COPY --from=builder /app/packages/cli-cards/package.json ./packages/cli-cards/package.json
COPY --from=builder /app/packages/cli-cards/src ./packages/cli-cards/src
# handled-error is the shared HandledError contract. It is imported from
# src/server/event-sourcing/services/errorHandling.ts, so every `pnpm task`
# entrypoint loads it -- including the chart's post-install hook Jobs, which
# failed with MODULE_NOT_FOUND until this was copied.
COPY --from=builder /app/packages/handled-error/package.json ./packages/handled-error/package.json
COPY --from=builder /app/packages/handled-error/src ./packages/handled-error/src
# These workspace packages declare peers (cli-cards: zod, handled-error:
# @opentelemetry/api) rather than depending on them. Because they live outside
# /app/langwatch, expose the app's production copies at the nearest shared
# node_modules boundary after dev dependencies have been pruned.
RUN mkdir -p ./node_modules \
  && ln -s ../langwatch/node_modules/zod ./node_modules/zod \
  && ln -s ../langwatch/node_modules/@opentelemetry ./node_modules/@opentelemetry
COPY --from=builder /app/langevals/ts-integration/evaluators.generated.ts ./langevals/ts-integration/evaluators.generated.ts
COPY --from=builder /app/feature-map.json ./feature-map.json

ENV NODE_ENV=production
EXPOSE 5560

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD cd langwatch && pnpm start

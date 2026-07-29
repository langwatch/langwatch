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

# Since ADR-076 the repo is a SINGLE pnpm workspace: the lockfile, the
# workspace definition and the hoist settings all live at the root, and
# langwatch/ is one member of it. The install therefore runs from /app rather
# than /app/langwatch, and is narrowed with a filter so the TypeScript SDK,
# the skills compiler and the e2e suites never enter the image.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY langwatch/package.json ./langwatch/
# Every workspace member's manifest must be present or `--frozen-lockfile`
# has nothing to check the lockfile against. These three carry no source into
# the image — only the manifest the workspace needs to stay coherent.
COPY typescript-sdk/package.json ./typescript-sdk/
COPY agentic-e2e-tests/package.json ./agentic-e2e-tests/
# The `packages/*` workspace members (e.g. @langwatch/observability, @langwatch/api)
# are consumed as source, so pnpm install must see their package.json to link them
# and install their own dependencies (pino, pino-pretty, ...) into
# packages/*/node_modules. Without this the app bundle build fails to resolve those
# deps (e.g. "Rolldown failed to resolve import 'pino'"). Same reason mcp-server is
# copied early above. node_modules is dockerignored, so only source is copied here.
COPY langwatch/packages ./langwatch/packages
COPY langwatch/vendor ./langwatch/vendor
# https://stackoverflow.com/questions/70154568/pnpm-equivalent-command-for-npm-ci
RUN CI=true pnpm install --frozen-lockfile --filter "@langwatch/web..."
COPY langwatch ./langwatch
RUN cd langwatch && NODE_OPTIONS=--max-old-space-size=4096 pnpm run build

# Remove dev dependencies — not needed at runtime. A filtered re-install with
# --prod rather than `pnpm prune --prod`: prune takes no --filter, so in a
# workspace it reasons about every project instead of the one subtree we
# installed. Both converge on the same prod-only tree.
RUN CI=true pnpm install --frozen-lockfile --prod --filter "@langwatch/web..."
# Regenerate Prisma client after pruning (prisma is a prod dep, but generate needs re-run)
RUN cd langwatch && pnpm prisma generate

# ── Stage 2: runtime ───────────────────────────────────────────────
FROM node:24-alpine
RUN apk --no-cache add curl openssl bash
RUN npm install -g pnpm@10.24.0

COPY --from=builder /usr/local/bin/goose /usr/local/bin/goose

WORKDIR /app

# Copy built artifacts from builder.
#
# /app/node_modules FIRST, and it is not optional. Since ADR-076 the install
# root is /app, not /app/langwatch, so pnpm's virtual store lives at
# /app/node_modules/.pnpm and every entry in langwatch/node_modules is a
# symlink into it:
#
#   langwatch/node_modules/react -> ../../node_modules/.pnpm/react@…/node_modules/react
#
# Copying langwatch/ without it leaves every one of those links dangling. The
# image builds clean and dies at boot on the first import — there is no build
# error to catch it, which is exactly why it is spelled out here.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/langwatch ./langwatch
# mcp-server must be copied alongside langwatch because pnpm workspace
# symlinks langwatch/node_modules/@langwatch/mcp-server -> ../../../mcp-server.
# langy and handled-error are other root workspace packages linked the same
# way. Both are loaded by migration tasks as well as the running server —
# handled-error is imported for side effects by the server and worker entry
# points, so omitting it fails the boot outright.
COPY --from=builder /app/mcp-server ./mcp-server
# Whole directories, including each package's own node_modules. langy and
# handled-error declare zod / @opentelemetry/api as PEERS, and pnpm satisfies
# those by linking them into the member's own node_modules, pointing at the
# shared store above. That replaces the hand-built symlinks this stage used to
# create at /app/node_modules — which would now collide with the real store,
# and are unnecessary because pnpm already did the job correctly.
COPY --from=builder /app/packages/langy ./packages/langy
COPY --from=builder /app/packages/handled-error ./packages/handled-error
COPY --from=builder /app/langevals/ts-integration/evaluators.generated.ts ./langevals/ts-integration/evaluators.generated.ts
COPY --from=builder /app/feature-map.json ./feature-map.json

ENV NODE_ENV=production
EXPOSE 5560

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD cd langwatch && pnpm start

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

# The repo is a single pnpm workspace rooted at /app. Copy the workspace
# manifests plus the member manifests this image needs; members that are in
# pnpm-workspace.yaml but absent from the build context (sdks/typescript,
# skills, tests/agentic-e2e, packages/server) are simply skipped by pnpm.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
# mcp/typescript is a workspace member — copy it early so pnpm install can link it.
# Its build runs automatically as part of the app's `pnpm run build`
# (via start:prepare:files → build:mcp-server).
COPY mcp/typescript ./mcp/typescript
COPY services/langevals/ts-integration/evaluators.generated.ts ./services/langevals/ts-integration/evaluators.generated.ts
COPY packages ./packages
COPY skills ./skills
COPY infra/docker/Dockerfile.langyagent ./infra/docker/Dockerfile.langyagent
COPY feature-map.json ./feature-map.json

COPY platform/app/package.json ./platform/app/
COPY platform/app/vendor ./platform/app/vendor
# The nested workspace packages must be present at install time or pnpm skips
# their importers and their dependencies never land in node_modules.
COPY platform/app/packages ./platform/app/packages
# https://stackoverflow.com/questions/70154568/pnpm-equivalent-command-for-npm-ci
RUN CI=true pnpm install --frozen-lockfile
COPY platform/app ./platform/app
RUN cd platform/app && NODE_OPTIONS=--max-old-space-size=4096 pnpm run build

# Remove dev dependencies — not needed at runtime. `install --prod` against the
# same frozen lockfile is the workspace-wide prune.
RUN CI=true pnpm install --frozen-lockfile --prod
# Regenerate Prisma client after pruning (prisma is a prod dep, but generate needs re-run)
RUN cd platform/app && pnpm prisma generate

# ── Stage 2: runtime ───────────────────────────────────────────────
FROM node:24-alpine
RUN apk --no-cache add curl openssl bash
RUN npm install -g pnpm@10.24.0

COPY --from=builder /usr/local/bin/goose /usr/local/bin/goose

WORKDIR /app

# Copy built artifacts from builder.
# The workspace root manifests and the shared virtual store (/app/node_modules)
# must come along: member node_modules are symlink farms pointing back into
# ../../node_modules/.pnpm. mcp/typescript must be copied alongside
# platform/app because the workspace symlinks
# platform/app/node_modules/@langwatch/mcp-server -> the mcp/typescript tree.
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/platform/app ./platform/app
COPY --from=builder /app/mcp/typescript ./mcp/typescript
# Root workspace packages (cli-cards, handled-error, ...) are consumed as
# source at runtime (migration tasks and the running server); their
# node_modules symlink farms resolve into the copied root virtual store.
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/langevals/ts-integration/evaluators.generated.ts ./services/langevals/ts-integration/evaluators.generated.ts
COPY --from=builder /app/feature-map.json ./feature-map.json

ENV NODE_ENV=production
EXPOSE 5560

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD cd platform/app && pnpm start

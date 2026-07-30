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

# mcp/typescript is a workspace member — copy it early so pnpm install can link
# it. Its build runs automatically as part of the app's `pnpm run build`
# (via start:prepare:files → build:mcp-server).
COPY mcp/typescript ./mcp/typescript
COPY services/langevals/ts-integration/evaluators.generated.ts ./services/langevals/ts-integration/evaluators.generated.ts
COPY packages ./packages
COPY skills ./skills
COPY infra/docker/Dockerfile.langyagent ./infra/docker/Dockerfile.langyagent
COPY feature-map.json ./feature-map.json

# Since ADR-076 the repo is a SINGLE pnpm workspace: the lockfile, the
# workspace definition and the hoist settings all live at the root, and
# platform/app/ is one member of it. The install therefore runs from /app rather
# than /app/platform/app, and is narrowed with a filter so the TypeScript SDK,
# the skills compiler and the e2e suites never enter the image.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY platform/app/package.json ./platform/app/
# Every workspace member's manifest must be present or `--frozen-lockfile`
# has nothing to check the lockfile against. This one carries no source into
# the image — only the manifest the workspace needs to stay coherent.
COPY tests/agentic-e2e/package.json ./tests/agentic-e2e/
# The SDK, in full, because the app declares `langwatch: workspace:*` and so
# imports THIS copy rather than a published release. Manifest-only was enough
# while the app resolved the registry tarball; now the app's bundle cannot be
# built without the SDK's own build output.
COPY sdks/typescript ./sdks/typescript
# The SDK's `prepare` runs copy-types.sh, which GENERATES the SDK's types from
# the application's source — so the SDK's install needs app files, while the app
# needs the SDK. That cycle is why manifest-only worked before: a published
# tarball ships the generated types already. Bring in exactly the inputs the
# generators read, ahead of the install, rather than copying the whole app here
# and losing the dependency layer's cache on every source edit. Same shape as
# Dockerfile.langyagent, which has to solve this too.
COPY platform/app/src/server/tracer/types.ts              ./platform/app/src/server/tracer/types.ts
COPY platform/app/src/server/filters/types.ts             ./platform/app/src/server/filters/types.ts
COPY platform/app/src/server/evaluations/types.ts         ./platform/app/src/server/evaluations/types.ts
COPY platform/app/src/server/evaluations/evaluators.native.ts ./platform/app/src/server/evaluations/evaluators.native.ts
COPY platform/app/src/server/modelProviders/llmModels.json ./platform/app/src/server/modelProviders/llmModels.json
COPY platform/app/src/app/api/openapiLangWatch.json       ./platform/app/src/app/api/openapiLangWatch.json
# The `packages/*` workspace members (e.g. @langwatch/observability, @langwatch/api)
# are consumed as source, so pnpm install must see their package.json to link them
# and install their own dependencies (pino, pino-pretty, ...) into
# packages/*/node_modules. Without this the app bundle build fails to resolve those
# deps (e.g. "Rolldown failed to resolve import 'pino'"). Same reason mcp/typescript
# is copied early above — and why `COPY packages` above brings the whole tree, now
# that all nine members live there. node_modules is dockerignored, so only source
# is copied here.
COPY platform/app/vendor ./platform/app/vendor
# https://stackoverflow.com/questions/70154568/pnpm-equivalent-command-for-npm-ci
RUN CI=true pnpm install --frozen-lockfile --filter "@langwatch/web..."
COPY platform/app ./platform/app
# `--filter "@langwatch/web..."` rather than a bare `pnpm run build` in the app
# directory: the trailing `...` makes pnpm build the app's workspace
# DEPENDENCIES first, in topological order. The app imports `langwatch` from the
# SDK working copy, so the SDK's dist has to exist before vite resolves it —
# and pnpm already knows that order from the dependency graph.
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter "@langwatch/web..." run build

# Remove dev dependencies — not needed at runtime, and on the order of a
# gigabyte of vite, vitest, playwright and biome. A filtered re-install with
# --prod rather than `pnpm prune --prod`: prune takes no --filter, so in a
# workspace it reasons about every project instead of the one subtree we
# installed.
#
# CI=true is load-bearing. --prod purges the modules directory, and pnpm
# refuses to do that without a TTY unless told it is non-interactive
# (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). The root .npmrc also carries
# confirm-modules-purge=false, so either alone suffices; both are kept because
# losing this silently would leave a dev-dependency-laden production image,
# and losing it loudly fails the build here where the cause is obvious.
# --ignore-scripts: this pass exists only to drop devDependencies. Without it
# the SDK's `prepare` re-runs here and dies — it regenerates types with
# openapi-typescript, a devDependency this very command is removing. Nothing
# needs regenerating at this point; the dist was built in the step above, and
# the Prisma client is regenerated explicitly after the prune below.
RUN CI=true pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@langwatch/web..."

# ...and then actually reclaim the disk. The step above rewrites each member's
# node_modules — the devDependency symlinks go — but it does NOT touch the
# virtual store, and the store is what the runtime stage copies wholesale as
# /app/node_modules. Measured on a scratch workspace: after
# `pnpm install --prod`, `node_modules/.pnpm/<devdep>@<ver>` is still present;
# after `pnpm prune --prod` it is gone. Without this line vite, vitest,
# playwright, biome and esbuild all ship in the production image, merely
# unreferenced — roughly the gigabyte this step is supposed to remove.
#
# `prune` takes no --filter, which is why the install above is filtered and
# this is not. That is fine here: the members outside the app's closure have
# no node_modules in this image at all, so there is nothing for prune to get
# wrong. It must run BEFORE `prisma generate`, because prune drops the
# generated client (it is not a declared dependency).
RUN CI=true pnpm prune --prod
# Regenerate Prisma client after pruning (prisma is a prod dep, but generate needs re-run)
WORKDIR /app/platform/app
RUN pnpm prisma generate
WORKDIR /app

# ── Stage 2: runtime ───────────────────────────────────────────────
FROM node:24-alpine
RUN apk --no-cache add curl openssl bash
RUN npm install -g pnpm@10.24.0

COPY --from=builder /usr/local/bin/goose /usr/local/bin/goose

WORKDIR /app

# Copy built artifacts from builder.
#
# /app/node_modules FIRST, and it is not optional. Since ADR-076 the install
# root is /app, not /app/platform/app, so pnpm's virtual store lives at
# /app/node_modules/.pnpm and every entry in platform/app/node_modules is a
# symlink into it:
#
#   platform/app/node_modules/react -> ../../../node_modules/.pnpm/react@…/node_modules/react
#
# Copying platform/app/ without it leaves every one of those links dangling. The
# image builds clean and dies at boot on the first import — there is no build
# error to catch it, which is exactly why it is spelled out here.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/platform/app ./platform/app
# mcp/typescript must be copied alongside the app because pnpm workspace
# symlinks platform/app/node_modules/@langwatch/mcp-server -> ../../../../mcp/typescript.
# langy and handled-error are other root workspace packages linked the same
# way. Both are loaded by migration tasks as well as the running server —
# handled-error is imported for side effects by the server and worker entry
# points, so omitting it fails the boot outright.
COPY --from=builder /app/mcp/typescript ./mcp/typescript
# Same reasoning for the SDK: `langwatch: workspace:*` means
# platform/app/node_modules/langwatch is a symlink to ../../../sdks/typescript,
# and a symlink whose target this stage never copies dangles at first import.
COPY --from=builder /app/sdks/typescript ./sdks/typescript
# The whole packages/ tree, not a cherry-picked list.
#
# Two reasons. First, each package's own node_modules comes with it: langy and
# handled-error declare zod / @opentelemetry/api as PEERS, and pnpm satisfies
# those by linking them into the member's own node_modules, pointing at the
# shared store above. That replaces the hand-built symlinks this stage used to
# create at /app/node_modules — which would now collide with the real store,
# and are unnecessary because pnpm already did the job correctly.
#
# Second, cherry-picking is the failure mode. Adding a root workspace package
# as an app dependency and forgetting to add a COPY line here leaves a
# dangling symlink and a boot-time "Cannot find module" — which is exactly how
# @langwatch/handled-error broke the workers entry point once already. Copying
# the tree cannot be forgotten. It costs about 1.3MB (packages/server, the npx
# CLI, is the only member the app does not import) against an image measured
# in hundreds.
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/langevals/ts-integration/evaluators.generated.ts ./services/langevals/ts-integration/evaluators.generated.ts
COPY --from=builder /app/feature-map.json ./feature-map.json

ENV NODE_ENV=production
EXPOSE 5560

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD cd platform/app && pnpm start

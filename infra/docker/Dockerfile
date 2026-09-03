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

# mcp/typescript is a workspace member — copy it early so pnpm install can
# link it. `@langwatch/hosted-mcp-server` depends on it, so its build runs as
# part of the API's dependency build below.
COPY mcp/typescript ./mcp/typescript
COPY services/langevals/ts-integration/evaluators.generated.ts ./services/langevals/ts-integration/evaluators.generated.ts
COPY packages ./packages
COPY skills ./skills
COPY infra/docker/Dockerfile.langyagent ./infra/docker/Dockerfile.langyagent
COPY feature-map.json ./feature-map.json

# Since ADR-076 the repo is a SINGLE pnpm workspace: the lockfile, the
# workspace definition and the hoist settings all live at the root, and the
# three deployable applications — apps/api, apps/worker and apps/ui — are three
# of its members. The install runs from /app and is narrowed with a filter so
# the TypeScript SDK's e2e suites, the skills compiler and apps/server (the npx
# self-host CLI, which is published separately) never enter the image.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
# Every workspace member's manifest must be present or `--frozen-lockfile`
# has nothing to check the lockfile against. This one carries no source into
# the image — only the manifest the workspace needs to stay coherent.
COPY dev/tests/agentic-e2e/package.json ./dev/tests/agentic-e2e/
# The SDK, in full, because the app declares `langwatch: workspace:*` and so
# imports THIS copy rather than a published release. Manifest-only was enough
# while the app resolved the registry tarball; now the app's bundle cannot be
# built without the SDK's own build output.
COPY sdks/typescript ./sdks/typescript
# The SDK's `pnpm run generate` (its `prebuild`) runs copy-types.sh, which
# GENERATES the SDK's types from first-party source. Every input it still reads
# is already in the image at this point: the trace, evaluator and
# model-provider contracts and packages/redaction arrive with `COPY packages`
# above, the langevals catalogue and feature-map.json with their own lines, and
# the skills bundle with `COPY skills`. Its one remaining application input —
# apps/api/src/features/discovery/openapi-document.json, from which
# `generate:openapi-types` derives the REST client — arrives with `COPY apps/api`
# below, ahead of the build that runs the generator.
#
# The four monolith source files that used to be copied here are gone from the
# tree, and so are the two generators that read them — their output was imported
# by nothing in the SDK. See copy-types.sh.
# The `packages/*` workspace members (e.g. @langwatch/observability, @langwatch/api)
# are consumed as source, so pnpm install must see their package.json to link them
# and install their own dependencies (pino, pino-pretty, ...) into
# packages/*/node_modules. Without this the app bundle build fails to resolve those
# deps (e.g. "Rolldown failed to resolve import 'pino'"). Same reason mcp/typescript
# is copied early above — and why `COPY packages` above brings the whole tree, now
# that all nine members live there. node_modules is dockerignored, so only source
# is copied here.
#
# The three applications are copied manifest-first for the same reason
# (https://stackoverflow.com/questions/70154568/pnpm-equivalent-command-for-npm-ci):
# the install layer must not be invalidated by a source edit.
COPY apps/worker/package.json ./apps/worker/package.json
# The interactive API process. It also owns both schema migrations the boot
# below runs — the Prisma runner over @langwatch/prisma-client's history, and
# the goose runner, TTL reconciler and ClickHouse SQL.
COPY apps/api/package.json ./apps/api/package.json
# The browser bundle. `@langwatch/ui` is a Vite build rather than a process:
# it emits dist/client, which the API process serves.
COPY apps/ui/package.json ./apps/ui/package.json
# Three filters, because the three applications are three dependency subtrees
# and none is a subset of the others.
RUN CI=true pnpm install --frozen-lockfile --filter "@langwatch/platform-api..." --filter "@langwatch/worker..." --filter "@langwatch/ui..."
COPY apps/worker ./apps/worker
COPY apps/api ./apps/api
COPY apps/ui ./apps/ui
# The trailing `...` on each filter makes pnpm build each application's
# workspace DEPENDENCIES first, in topological order, and pnpm skips the
# members that declare no `build`. That order is load-bearing twice over: the
# packages import `langwatch` from the SDK working copy, so the SDK's dist has
# to exist before vite resolves it, and `@langwatch/hosted-mcp-server` imports
# `@langwatch/mcp-server`, whose dist the API needs at boot. Both are reached
# through the api/worker filters, not the ui one — apps/api and apps/worker
# declare no `build` of their own and run from source through tsx.
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter "@langwatch/ui..." --filter "@langwatch/platform-api..." --filter "@langwatch/worker..." run build

# Remove dev dependencies — not needed at runtime, and on the order of a
# gigabyte of vite, vitest and playwright. A filtered re-install with
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
RUN CI=true pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@langwatch/platform-api..." --filter "@langwatch/worker..." --filter "@langwatch/ui..."

# ...and then actually reclaim the disk. The step above rewrites each member's
# node_modules — the devDependency symlinks go — but it does NOT touch the
# virtual store, and the store is what the runtime stage copies wholesale as
# /app/node_modules. Measured on a scratch workspace: after
# `pnpm install --prod`, `node_modules/.pnpm/<devdep>@<ver>` is still present;
# after `pnpm prune --prod` it is gone. Without this line vite, vitest,
# playwright and esbuild all ship in the production image, merely
# unreferenced — roughly the gigabyte this step is supposed to remove.
#
# `prune` takes no --filter, which is why the install above is filtered and
# this is not. That is fine here: the members outside the app's closure have
# no node_modules in this image at all, so there is nothing for prune to get
# wrong. No post-prune `prisma generate` anymore: @langwatch/prisma-client owns
# generated first-party source that the build above inlines into the dist
# bundles, so prune cannot drop it. The runtime stage still needs the `prisma`
# CLI (a prod dep) for `migrate deploy` at boot.
RUN CI=true pnpm prune --prod

# ── Stage 2: runtime ───────────────────────────────────────────────
FROM node:24-alpine
RUN apk --no-cache add curl openssl bash
RUN npm install -g pnpm@10.24.0

COPY --from=builder /usr/local/bin/goose /usr/local/bin/goose

WORKDIR /app

# Copy built artifacts from builder.
#
# /app/node_modules FIRST, and it is not optional. Since ADR-076 the install
# root is /app, so pnpm's virtual store lives at /app/node_modules/.pnpm and
# every entry in an application's node_modules is a symlink into it:
#
#   apps/api/node_modules/hono -> ../../../node_modules/.pnpm/hono@…/node_modules/hono
#
# Copying apps/ without it leaves every one of those links dangling. The image
# builds clean and dies at boot on the first import — there is no build error to
# catch it, which is exactly why it is spelled out here.
COPY --from=builder /app/node_modules ./node_modules
# mcp/typescript must be copied alongside the applications because pnpm
# workspace-symlinks @langwatch/mcp-server into
# packages/features/hosted-mcp/server/node_modules, which apps/api mounts. langy
# and handled-error are other root workspace packages linked the same way —
# handled-error is imported for side effects by the API and worker entry points,
# so omitting it fails the boot outright.
COPY --from=builder /app/mcp/typescript ./mcp/typescript
# Same reasoning for the SDK: `langwatch: workspace:*` in a dozen packages means
# their node_modules/langwatch is a symlink to ../../../sdks/typescript, and a
# symlink whose target this stage never copies dangles at first import.
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
# the tree cannot be forgotten. It costs about 1.3MB; apps/server, the npx CLI,
# is separate and is the only workspace application the app does not import
# in hundreds.
COPY --from=builder /app/packages ./packages
# The worker executable runs from source through tsx, the way apps/api does.
COPY --from=builder /app/apps/worker ./apps/worker
# Same: run from source through tsx. The boot command below runs both schema
# migrations from here before anything serves.
COPY --from=builder /app/apps/api ./apps/api
# The browser half. Whole, not just dist/client: apps/api imports
# `@langwatch/ui/public-config` as SOURCE to build the boot configuration it
# injects into the HTML shell, so the package has to resolve at runtime as well
# as its build output being on disk.
COPY --from=builder /app/apps/ui ./apps/ui
COPY --from=builder /app/services/langevals/ts-integration/evaluators.generated.ts ./services/langevals/ts-integration/evaluators.generated.ts
COPY --from=builder /app/feature-map.json ./feature-map.json

ENV NODE_ENV=production
EXPOSE 5560

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

# The boot chain, all four steps from one directory. `apps/api` owns both
# migrations — the Prisma runner over @langwatch/prisma-client's history and the
# goose runner, TTL reconciler and ClickHouse SQL — as well as the LangWatchQL
# provisioner and the process itself.
#
# The order is load-bearing: LangWatchQL provisioning reads both the Postgres
# schema and the ClickHouse one, so it cannot run before either. Sequenced with
# `&&` so a failed migration stops the boot rather than serving against a schema
# that was never applied.
#
# `pnpm -s run start` is `tsx src/api.entrypoint.ts`. The API process serves the
# REST, tRPC and SSE families AND the browser bundle it finds at
# /app/apps/ui/dist/client, so this one container is the whole interactive tier.
CMD cd /app/apps/api && pnpm -s run task:prisma-migrate && pnpm -s run task:clickhouse-migrate && pnpm -s run task:lwql-provision && pnpm -s run start

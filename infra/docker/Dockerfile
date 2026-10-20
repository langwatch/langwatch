# ── Stage 0: the dev-script binary ──────────────────────────────────
# generate:modules is Go (cmd/devscripts,
# stdlib only). Built here so the builder carries the binary and no Go
# toolchain, and so this layer caches until those two directories change.
# `go mod download` is skipped on purpose: the binary imports no module.
FROM golang:1.27.2-alpine AS devscripts
WORKDIR /src
COPY go.work go.work.sum ./
COPY cmd/go.* cmd/
COPY pkg/go.* pkg/
COPY services/go.* services/
COPY tools/go.* tools/
COPY sdks/go/go.* sdks/go/
COPY infra/clickhouse-serverless/go.* infra/clickhouse-serverless/
COPY cmd/devscripts ./cmd/devscripts
COPY tools/devscripts ./tools/devscripts
# devscripts imports these two stdlib-only packages.
COPY tools/cliprof ./tools/cliprof
COPY tools/internal ./tools/internal
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 go build -o /out/devscripts ./cmd/devscripts

# ── Stage 0b: the Go scenario runner ────────────────────────────────
# services/scenariorunner, the Go drop-in for the Node scenario child. Its own
# binary, never a cmd/service subcommand: that refuses to boot with
# LANGWATCH_API_KEY set, and a run's key arrives in exactly that variable.
# Cross-compiled on the build host, like Dockerfile.go_service.
FROM --platform=$BUILDPLATFORM golang:1.27.2-alpine AS scenariorunner
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.work go.work.sum ./
COPY cmd/go.* cmd/
COPY pkg/go.* pkg/
COPY services/go.* services/
COPY tools/go.* tools/
COPY sdks/go/go.* sdks/go/
COPY infra/clickhouse-serverless/go.* infra/clickhouse-serverless/
COPY pkg ./pkg
COPY sdks/go ./sdks/go
COPY services/scenariorunner ./services/scenariorunner
COPY services/third_party ./services/third_party
RUN --mount=type=cache,target=/go/pkg/mod,id=go-mod-${TARGETARCH} \
    --mount=type=cache,target=/root/.cache/go-build,id=go-build-${TARGETARCH} \
    cd services && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
      -trimpath -ldflags="-s -w" -o /out/scenariorunner ./scenariorunner/cmd/scenariorunner

# ── Stage 1: workspace manifests ───────────────────────────────────
# Every member's package.json and nothing else. This stage re-runs on any
# source edit, but its output changes only when a manifest does, so the
# install layer below stays cached across source-only commits.
FROM node:24-alpine AS manifests
WORKDIR /src
COPY mcp/typescript ./mcp/typescript
COPY packages ./packages
COPY modules ./modules
COPY enterprise ./enterprise
COPY skills ./skills
COPY sdks/typescript ./sdks/typescript
RUN find . ! -type d ! -name package.json -delete && find . -depth -type d -empty -delete

# ── Stage 1b: the Node toolchain ────────────────────────────────────
# What both installs below need: pnpm, and the compilers a dependency's build
# script (allowBuilds in pnpm-workspace.yaml: bcrypt, node-pty and the rest) falls back to.
# The pnpm store sits in a BuildKit cache mount at this path on every install,
# so a lockfile change downloads only what is new.
FROM node:24-alpine AS node-toolchain
RUN apk --no-cache add curl python3 make gcc g++ openssl bash
RUN npm install -g pnpm@12.6.0 && npm cache clean --force
ENV pnpm_config_store_dir=/root/.local/share/pnpm/store

# ── Stage 1c: production dependencies ──────────────────────────────
# The runtime's node_modules, from install inputs only, so this stage and the
# runtime layer copying it stay cached until the lockfile or a manifest changes.
# The workspace members here are manifests; the runtime stage lays their built
# trees over these node_modules directories.
FROM node-toolchain AS prod-deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY patches ./patches
COPY vendor ./vendor
COPY --from=manifests /src/ ./
# The same workspace the builder's production install used to see, so the re-resolve matches it.
COPY dev/tests/agentic-e2e/package.json ./dev/tests/agentic-e2e/
COPY dev/tests/e2e-stack/package.json ./dev/tests/e2e-stack/
COPY tools/seedgen/runner/package.json ./tools/seedgen/runner/
COPY dev/scripts/package.json ./dev/scripts/
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/ui/package.json ./apps/ui/package.json
COPY apps/tasks/package.json ./apps/tasks/package.json
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/scenario-child/package.json ./apps/scenario-child/package.json
COPY infra/docker/image.pnpmfile.cjs /tmp/image.pnpmfile.cjs
COPY infra/docker/check-locked-versions.mjs /tmp/check-locked-versions.mjs
COPY infra/docker/check-links.mjs /tmp/check-links.mjs
# Three roles, the backend that hosts two of them and the scenario child the worker spawns;
# @langwatch/ui is not installed, its bundle is built. --filter-prod, not --filter: with --prod alone
# a filtered member's devDependencies are still followed. The image pnpmfile drops the peers that resolve to dev tools (see its header); a hook
# runs only when pnpm resolves, so the lockfile is re-resolved first and the version check fails the
# build on any version the committed lockfile does not name. Dependency build scripts run here.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    export pnpm_config_pnpmfile=/tmp/image.pnpmfile.cjs CI=true \
 && cp pnpm-lock.yaml /tmp/committed-pnpm-lock.yaml \
 && pnpm install --lockfile-only \
 && node /tmp/check-locked-versions.mjs /tmp/committed-pnpm-lock.yaml pnpm-lock.yaml \
 && pnpm install --frozen-lockfile --prod --filter-prod "@langwatch/platform-api..." --filter-prod "@langwatch/worker..." --filter-prod "@langwatch/scenario-child..." --filter-prod "@langwatch/tasks..." --filter-prod "@langwatch/backend..."

# The installed packages' own weight: source maps, declarations, tests, docs and examples, and the
# query compiler Prisma ships for every database it supports (this image talks to PostgreSQL only).
RUN find node_modules/.pnpm -type d \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name example -o -name examples \) -prune -exec rm -rf {} + \
 && find node_modules/.pnpm -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.md' \) -delete \
 && find node_modules/.pnpm -type f -name 'query_compiler_*' ! -name '*postgresql*' -delete \
 && node /tmp/check-links.mjs /app

# The Prisma CLI is here for `prisma migrate deploy` (the upgrade runs it) and nothing else. Its entry
# file needs Studio's data modules and the dev server's state module at load; Studio's browser UI,
# the dev server's bundled database, the query-plan executor and Studio's graph layout go, with the
# links that pointed at them.
RUN rm -rf node_modules/.pnpm/@prisma+studio-core@*/node_modules/@prisma/studio-core/dist/ui \
      node_modules/.pnpm/@prisma+studio-core@*/node_modules/@prisma/studio-core/dist/metafile-*.json \
      node_modules/.pnpm/@prisma+dev@*/node_modules/@prisma/dev/dist/runtime-assets \
      node_modules/.pnpm/@prisma+query-plan-executor@* node_modules/.pnpm/@electric-sql+pglite* node_modules/.pnpm/elkjs@* \
 && find node_modules/.pnpm -type l \( -path '*/@prisma/query-plan-executor' -o -path '*/@electric-sql/pglite*' -o -path '*/node_modules/elkjs' \) -delete \
 && node /tmp/check-links.mjs /app

# Only node_modules directories leave this stage: the manifests, lockfile and workspace file go (the
# runtime must carry no pnpm-workspace.yaml, see pnpm_config_verify_deps_before_run there), and so
# do the member directories that got no node_modules. The runtime stage checks the links once the
# built trees are in place.
RUN find . -name node_modules -prune -o ! -type d -exec rm -f {} + \
 && find . -depth -type d -empty ! -path '*/node_modules/*' -delete

# ── Stage 2: build ──────────────────────────────────────────────────
FROM node-toolchain AS builder

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

# Install inputs only (ADR-076: one workspace, installed from /app). Nothing
# here may change on a source-only edit, or the install below re-runs.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
# patchedDependencies reads patches/; the lockfile resolves @langwatch/scenario to vendor/.
COPY patches ./patches
COPY vendor ./vendor
COPY --from=manifests /src/ ./
# Manifest-only members: `--frozen-lockfile` and `pnpm prune` need them, never their source.
COPY dev/tests/agentic-e2e/package.json ./dev/tests/agentic-e2e/
COPY dev/tests/e2e-stack/package.json ./dev/tests/e2e-stack/
COPY tools/seedgen/runner/package.json ./tools/seedgen/runner/
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/ui/package.json ./apps/ui/package.json
COPY apps/tasks/package.json ./apps/tasks/package.json
COPY apps/scenario-child/package.json ./apps/scenario-child/package.json
# Five filters: the five applications are five dependency subtrees and none is
# a subset of another (the scenario child's build needs its own esbuild). apps/server
# and the SDK's e2e suites stay out. No workspace member has an install lifecycle
# script, so no source is needed yet.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    CI=true pnpm install --frozen-lockfile --filter "@langwatch/platform-api..." --filter "@langwatch/worker..." --filter "@langwatch/ui..." --filter "@langwatch/tasks..." --filter "@langwatch/scenario-child..."

# Source, after the install. The app imports the SDK and mcp/typescript as
# workspace copies and builds them; the SDK's prebuild (copy-types.sh) reads
# packages/, the langevals catalogue, feature-map.json and skills/.
COPY mcp/typescript ./mcp/typescript
COPY sdks/typescript ./sdks/typescript
COPY services/langevals/ts-integration/evaluators.generated.ts ./services/langevals/ts-integration/evaluators.generated.ts
COPY packages ./packages
COPY modules ./modules
COPY enterprise ./enterprise
COPY skills ./skills
COPY infra/docker/Dockerfile.langyagent ./infra/docker/Dockerfile.langyagent
COPY feature-map.json ./feature-map.json
# Every package tsconfig extends the root ones; build:types builds the contract build configs.
COPY tsconfig.base.json tsconfig.shared.json tsconfig.emit.json ./
COPY apps/worker ./apps/worker
COPY apps/api ./apps/api
COPY apps/ui ./apps/ui
COPY apps/tasks ./apps/tasks
COPY apps/backend ./apps/backend
COPY apps/scenario-child ./apps/scenario-child
# What `start:prepare:files` and `ensure:built` read: the generator scripts (and
# their Go binary, below).
COPY dev/scripts ./dev/scripts
# dev/scripts/devscripts.sh runs this binary when Go is not on PATH.
COPY --from=devscripts /out/devscripts /app/.bin/devscripts/devscripts
# The trailing `...` on each filter makes pnpm build each application's
# workspace DEPENDENCIES first, in topological order, and pnpm skips the
# members that declare no `build`. That order is load-bearing twice over: the
# packages import `langwatch` from the SDK working copy, so the SDK's dist has
# to exist before vite resolves it, and `@langwatch/hosted-mcp-process` imports
# `@langwatch/mcp-server`, whose dist the API needs at boot. Both are reached
# through the api/worker filters, not the ui one. apps/api declares no `build`
# of its own and runs from source through node; apps/worker declares none either
# now — the pre-compiled scenario child is its own app, @langwatch/scenario-child.
# The worker does not depend on it, so the worker filter's `...` never reaches it and
# it has its own filter (and its own --filter-prod below, for its external requires).
# The worker runs from source, but the child is a fresh
# process per simulation, so it is spawned as `node` on that bundle rather than
# `pnpm exec` on a TypeScript tree (the --prod
# install below drops it, so the bundle is the only supported path in an image).
# @see specs/scenarios/pre-compiled-child-process.feature
# Release stamp: release builds verify licences against the embedded LangWatch key only, so the
# image rewrites packages/config/src/release-build.ts here and runtime env cannot undo it. A
# dev-stamped image (upgradelab's licensed shape) builds with LANGWATCH_RELEASE_BUILD=false.
ARG LANGWATCH_RELEASE_BUILD=true
RUN if [ "$LANGWATCH_RELEASE_BUILD" = "true" ]; then \
      sed -i 's/^export const isReleaseBuild: boolean = false;$/export const isReleaseBuild: boolean = true;/' packages/config/src/release-build.ts \
      && grep -q '^export const isReleaseBuild: boolean = true;$' packages/config/src/release-build.ts; \
    fi
# Build commit stamp: the Upgrades page names a development build `<release>+<commit>` (ADR-173 §7).
ARG LANGWATCH_BUILD_COMMIT=""
RUN if echo "$LANGWATCH_BUILD_COMMIT" | grep -Eq '^[0-9a-f]{7,40}$'; then \
      SHORT_COMMIT=$(printf '%.7s' "$LANGWATCH_BUILD_COMMIT") \
      && sed -i "s/^export const buildCommit: string | null = null;\$/export const buildCommit: string | null = \"$SHORT_COMMIT\";/" packages/upgrade/src/reader/build-commit.ts \
      && grep -q "^export const buildCommit: string | null = \"$SHORT_COMMIT\";\$" packages/upgrade/src/reader/build-commit.ts; \
    fi

# The generated files and the four dist-resolving packages build first, since
# `build:types` reads their declarations. Each step calls its package script:
# this stage has no nx.json, so the root nx scripts cannot run here. Keep it in
# step with the root start:prepare:files, ensure:built and build:types. The last
# build's `!` filters skip the projects the first build already built.
RUN pnpm run ensure:ai-gateway-secrets && pnpm run generate:modules \
 && pnpm --filter @langwatch/prisma-client run prisma:generate \
 && pnpm --filter @langwatch/evaluator-contract run generate:evaluators \
 && pnpm --filter @langwatch/langy-browser run generate:langy-skills \
 && pnpm --filter @langwatch/langy-browser run generate:feature-map \
 && pnpm --filter @langwatch/langy-process run generate:setup-skill-bodies \
 && pnpm --filter "langwatch..." --filter "@langwatch/mcp-server..." --filter "@langwatch/ksuid..." --filter "@langwatch/mail..." run build \
 && NODE_OPTIONS=--max-old-space-size=4096 pnpm exec tsc -b --builders 16 modules/*/contract/tsconfig.build.json \
 && NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter "@langwatch/ui..." --filter "@langwatch/platform-api..." --filter "@langwatch/worker..." --filter "@langwatch/scenario-child..." --filter "!langwatch..." --filter "!@langwatch/mcp-server..." --filter "!@langwatch/ksuid..." --filter "!@langwatch/mail..." run build

# The built trees leave without node_modules: the runtime stage takes every node_modules directory
# from prod-deps and lays these trees over them, and a link left here would replace a production one
# with one into this stage's development install. The UI's source maps go too.
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
 && find apps/ui/dist/client -name '*.map' -delete

# What no process runs, removed before the runtime stage copies the trees: the module halves the
# browser loads (the api serves the built bundle), tests, specs, ADRs, declarations, source maps
# and the SDKs' sources and examples. Workspace packages nothing links to go too; the runtime
# stage's link check fails the build if any link now points at nothing.
RUN rm -rf modules/*/browser modules/*/client enterprise/modules/*/browser enterprise/modules/*/client \
      packages/architecture-enforcer packages/oxlint-rules packages/design-system packages/design-system-internal \
      packages/browser packages/browser-host packages/browser-types packages/sim-console packages/test-harness \
      packages/vitest-config packages/webhook-verify packages/ksuid-python \
 && find sdks/typescript mcp/typescript -mindepth 1 -maxdepth 1 ! -name dist ! -name package.json -exec rm -rf {} + \
 && find apps packages modules enterprise \
      \( -type d \( -name __tests__ -o -name tests -o -name e2e -o -name specs -o -name adrs -o -name docs -o -name examples \) -o \
         -type f \( -name '*.test.*' -o -name '*.spec.*' -o -name '*.feature' -o -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.tsbuildinfo' -o -name '*.md' \) \) \
      -prune -exec rm -rf {} +

# ── Stage 2b: CDN assets ───────────────────────────────────────────
# Not part of the runtime image: nothing reaches the default target through it.
# publish-docker-ecr.yml builds this target with a local output to upload the
# content-hashed files to the CDN bucket (ADR-086) from the builder layers it
# just cached, without pulling the pushed image back.
FROM scratch AS ui-assets
COPY --from=builder /app/apps/ui/dist/client/assets /assets

# ── Stage 3: runtime ───────────────────────────────────────────────
FROM node:24-alpine
RUN apk --no-cache add curl openssl bash
RUN npm install -g pnpm@12.6.0 && npm cache clean --force

COPY --from=builder /usr/local/bin/goose /usr/local/bin/goose
# The scenario SDK opens a voice worker's quick tunnel with a bare `cloudflared` spawn, so the
# binary is on the image's PATH; the worker never writes its own environment (Alex, 2026-09-28).
# Pinned to a release and its multi-arch index digest; bump both together.
COPY --from=cloudflare/cloudflared:2026.9.3@sha256:072c067d25ccbe61d46e18f0d0723255f2bb5304f7317caa95b27031520ff92c /usr/local/bin/cloudflared /usr/local/bin/cloudflared

WORKDIR /app

# Every node_modules directory, FIRST and in its own layer: prod-deps is built from install inputs
# only, so this layer is reused, and not pushed again, while the lockfile and manifests stay put.
# Each member's node_modules links into /app/node_modules/.pnpm and to other members, so the trees
# below must land on top of these directories, never replace them; the link check after the copies
# proves every link resolves.
COPY --from=prod-deps /app ./
# The Go scenario runner; the worker spawns it in place of the Node child for a
# project whose release_scenario_go_runner_enabled flag is on. Before the builder's
# trees, which change on every commit.
COPY --from=scenariorunner /out/scenariorunner /usr/local/bin/scenariorunner
ENV SCENARIO_GO_RUNNER_PATH=/usr/local/bin/scenariorunner
# The built trees from builder, which carry no node_modules. mcp/typescript and the SDK are copied
# because members link to them (@langwatch/mcp-server, `langwatch: workspace:*`); the whole
# packages/, modules/ and enterprise/ trees rather than a cherry-picked list, because a forgotten
# line leaves a dangling link and a boot-time "Cannot find module".
COPY --from=builder /app/mcp/typescript ./mcp/typescript
COPY --from=builder /app/sdks/typescript ./sdks/typescript
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/modules ./modules
COPY --from=builder /app/enterprise ./enterprise
# The worker executable runs from source through node, the way apps/api does. The
# child it spawns is its own app, built into apps/scenario-child/dist.
COPY --from=builder /app/apps/worker ./apps/worker
COPY --from=builder /app/apps/scenario-child ./apps/scenario-child
# The task runner. Runs from source through node, like apps/api and apps/worker.
COPY --from=builder /app/apps/tasks ./apps/tasks
# Same: run from source through node. The boot command below runs both schema
# migrations from here before anything serves.
COPY --from=builder /app/apps/api ./apps/api
# The api and the worker in one Node process: what START_WORKERS=true starts (see start.sh).
COPY --from=builder /app/apps/backend ./apps/backend
# The browser half is its built bundle only: the api serves files from apps/ui/dist/client
# (packages/process/src/transport/config-owner.ts) and imports nothing from @langwatch/ui.
COPY --from=builder /app/apps/ui/dist/client ./apps/ui/dist/client
COPY --from=builder /app/services/langevals/ts-integration/evaluators.generated.ts ./services/langevals/ts-integration/evaluators.generated.ts
COPY --from=builder /app/feature-map.json ./feature-map.json
# The two halves of /app meet only here, so this is where a dangling link would first exist. The
# script is mounted, not copied, so the image carries nothing new.
RUN --mount=type=bind,source=infra/docker/check-links.mjs,target=/tmp/check-links.mjs \
    node /tmp/check-links.mjs /app

# The default command: the api, or the api and worker in one process under START_WORKERS=true.
COPY --chmod=755 infra/docker/start.sh /app/start.sh
# DEPRECATED, kept for two releases: the previous release ran from /app/platform/app, and old
# compose files and Helm charts still say `cd /app/platform/app && pnpm run start:workers`.
# These scripts forward to /app/apps/*; delete this line with infra/docker/compat.
COPY infra/docker/compat/platform-app ./platform/app

ENV NODE_ENV=production
# pnpm 11+ checks dependencies before every `pnpm run` and installs when they
# look stale. This stage carries no pnpm-workspace.yaml or lockfile, so the
# check fails to resolve `catalog:` specs (ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC)
# and would write into /app, which is read-only under the chart. The dependencies
# were installed by the builder; every boot and task command is `pnpm run`.
ENV pnpm_config_verify_deps_before_run=false
# The api listens on API_PORT, else PORT (the previous release's variable), else 5560: start.sh
# resolves it, so none is pinned here and the HEALTHCHECK below follows the same order.

# Prisma's version check to checkpoint.prisma.io would run during the
# `prisma migrate deploy` every start does. LangWatch never uses it.
ENV CHECKPOINT_DISABLE=1

# Every tiktoken encoding file, so token counting reads it from disk instead of
# downloading it from openaipublic.blob.core.windows.net at runtime (about 8 MB).
# The script resolves tiktoken from the working directory, so it runs in the
# package that depends on it (the trace module's process half, not apps/worker).
ENV TIKTOKENS_PATH=/app/tiktoken
COPY dev/scripts/download-tiktoken-encodings.mjs ./dev/scripts/download-tiktoken-encodings.mjs
RUN cd modules/trace/process && node ../../../dev/scripts/download-tiktoken-encodings.mjs "$TIKTOKENS_PATH"

EXPOSE 5560

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

# One image, three roles, chosen by working directory and command (no rebuild):
#   api     (default) /app/start.sh, which runs `pnpm --silent run start` in /app/apps/api
#           REST, tRPC, SSE and the browser bundle from /app/apps/ui/dist/client.
#           Listens on API_PORT, else PORT, else 5560. With START_WORKERS=true it runs
#           apps/backend instead: the api and the worker in one process.
#           Probes on that port: startup and liveness /api/health, readiness /readyz.
#   worker  cd /app/apps/worker && pnpm --silent run start
#           Probes on WORKER_METRICS_PORT (2999): startup and liveness /healthz, readiness /readyz.
#   task    cd /app/apps/tasks  && pnpm --silent task <name>   (e.g. `upgrade status`)
#
# The api never runs an upgrade step: behind its ledger it serves every route (a
# schema it is not ready for answers 503 upgrade_in_progress with Retry-After) and
# stays not ready until the ledger is current (NO-HOLDS). The worker
# runs `pnpm task upgrade` at boot under the runner's lease (UPGRADE-IN-WORKER,
# dev/docs/runbooks/upgrade-on-deploy.md), so several workers are safe.
# Docker's own check, for compose and `docker run`; Kubernetes uses the probes above.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40m --retries=3 \
  CMD curl -fsS -o /dev/null "http://127.0.0.1:${API_PORT:-${PORT:-5560}}/api/health" \
   || curl -fsS -o /dev/null "http://127.0.0.1:${WORKER_METRICS_PORT:-2999}/healthz"
CMD ["/app/start.sh"]

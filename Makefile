.PHONY: help start sync-all-openapi user-delete-dry-run user-delete es-delete-dry-run es-delete
.PHONY: down logs clean ps quickstart quickstart-help worktree refresh-dev-s3
.PHONY: dev-up dev-down dev-logs setup-hooks service service-watch test-scripts
.PHONY: herrgen herrgen-check
.PHONY: lint-rules lint-rules-changed lint-rules-test go-lint go-lint-changed
.PHONY: _dev-up-deprecation-warning

# Surface every target — boxd-* are pulled in via include below.
help:
	@echo "LangWatch dev targets:"
	@echo ""
	@echo "  Primary (Docker dev environment):"
	@echo "    make quickstart                     interactive preset picker"
	@echo "    make quickstart all-local           local CH+PG+Redis+app+workers, no NLP (fast iteration default)"
	@echo "    make quickstart all-local-nlp       all-local + nlpgo + langevals"
	@echo "    make quickstart dev-storage         local DBs+workers, stored-objects -> dev S3 (runtime-storage-dev)"
	@echo "    make refresh-dev-s3                 rotate AWS SSO creds in .env (run before dev-storage)"
	@echo "    make quickstart dev-infra           local app + redis + workers compose; shared dev for PG/CH/NLP/S3"
	@echo "    make quickstart frontend-only       no compose; pure pnpm dev against your .env URLs"
	@echo "    make quickstart migration           postgres + clickhouse on host ports (prisma migrate; no workers)"
	@echo "    make quickstart full-local          kitchen-sink local (dedicated workers container + ai-server)"
	@echo "    make quickstart-help                non-interactive preset reference"
	@echo "    make service svc=<name>             run a Go service (e.g. aigateway)"
	@echo ""
	@echo "  Local dev by hostname (thuishaven):"
	@echo "    make haven install                  go install the haven binary (then run 'haven ...' directly)"
	@echo "    make haven up                       start this worktree's stack (bootstraps itself)"
	@echo "    make haven status                   every stack + shared-server health, one shot"
	@echo "    make haven <cmd>                    any haven subcommand (see 'haven help')"
	@echo "    (dashboard at https://langwatch.localhost)"
	@echo "    make service-watch svc=<name>       run a Go service with live reload (air)"
	@echo ""
	@echo "  Local observability (logs/traces/metrics → Grafana for agent debugging):"
	@echo "    make observability                  start the LGTM stack on colima, capped (OTLP :4318, Grafana :3000)"
	@echo "    make observability-connect          mint a Grafana token + configure gcx"
	@echo "    make observability-logs             tail the stack logs"
	@echo "    make observability-down             stop the stack (discards all telemetry)"
	@echo "    (once it is up, every 'pnpm dev' stack exports to it, tagged by worktree)"
	@echo "    make worktree <issue|name>          create a git worktree for an issue/feature"
	@echo "    make down                           stop all services"
	@echo "    make test-scripts                   run bats unit tests under dev/scripts/__tests__/"
	@echo "    make herrgen                        regenerate the Go error codes for TypeScript"
	@echo "    make herrgen-check                  fail if those generated codes are stale (CI)"
	@echo ""
	@echo "  Lint (deterministic house rules — no AI involved):"
	@echo "    make lint-rules                     ast-grep + semgrep over the whole repo"
	@echo "    make lint-rules-changed             ...over this branch's changes only (what CI gates on)"
	@echo "    make lint-rules-test                prove every rule still matches its fixture"
	@echo "    make go-lint                        golangci-lint at the pinned version CI uses"
	@echo "    make go-lint-changed                ...new/changed lines only"
	@echo ""
	@echo "  Boxd workflows (multi-step orchestration over the boxd CLI):"
	@echo "    make boxd-help                      full boxd target reference"
	@echo "    make boxd-golden                    create the canonical base VM"
	@echo "    make boxd-fork-pr PR=<n>            fork golden for an existing PR"
	@echo "    make boxd-fork-branch BRANCH=<n>    fork golden for a branch"
	@echo "    make boxd-fork-issue ISSUE=<n>      fork + worktree + tmux+claude in VM"
	@echo "    make boxd-connect-{pr,branch,issue} <ARG>=<v>   attach to the in-VM session"
	@echo "    make boxd-preview BRANCH=<n>        ephemeral PR-preview VM (team golden)"
	@echo "    make boxd-preview-down BRANCH=<n>   destroy preview VM"
	@echo "    make boxd-preview-status BRANCH=<n> VM status + stack state"
	@echo ""
	@echo "  Per-worktree isolated stacks (for AI agents / parallel work):"
	@echo "    make dev-up [PROFILE=full]            start isolated containers"
	@echo "    make dev-down                          stop isolated containers"
	@echo "    make dev-logs                          tail isolated logs"
	@echo ""
	@echo "  See: dev/docs/adr/004-docker-dev-environment.md, dev/docs/boxd-makefile.md"

include dev/boxd.mk
# dev/haven.mk is included at the BOTTOM of this file: its `make haven <sub>`
# passthrough neutralises the trailing words (e.g. `down`, `install`) as no-op
# goals, and for that override to beat the real `down` / `install` recipes it
# must be evaluated after they are defined. See the include at end of file.

# =============================================================================
# DOCKER DEV ENVIRONMENT (dev/compose.dev.yml)
# =============================================================================
# All services run in Docker with resource limits.
# App is volume-mounted for hot reload.

COMPOSE = docker compose -f dev/compose.dev.yml --project-directory .

# Sources dev/scripts/lib/sanitize-dev-env.sh and rewrites stale localhost-pinned
# NEXTAUTH_URL / BASE_HOST exports to the compose-derived APP_PORT (default
# 5560). Real overrides like boxd-proxy URLs are left untouched. Prepended
# to every dev `up` recipe so `make dev*` paths can't silently 403 on login
# if a previous session leaked the env (lw#3453).
SANITIZE_DEV_ENV = APP_PORT=$${APP_PORT:-5560} . dev/scripts/lib/sanitize-dev-env.sh && sanitize_localhost_dev_env

# Install git hooks (idempotent, runs automatically before dev targets)
setup-hooks:
	@git config core.hooksPath .githooks 2>/dev/null || true

# Run a Go service via the mono-binary.
# Usage: make service svc=aigateway
#
# Sources every var from .env into the Go process's environment.
# The gateway + control-plane intentionally share secrets (LW_GATEWAY_*,
# LW_VIRTUAL_KEY_PEPPER etc.) — one flat .env is simpler than namespace
# prefixes. Vars the Go service doesn't need are ignored.
#
# Pre-existing environment wins over .env: we snapshot the inbound env
# (export -p), source .env (which would otherwise overwrite everything),
# then re-apply the snapshot on top. This matches the "real env beats
# dotenv" contract that vite.config.ts + start.ts already follow. It is
# load-bearing for `pnpm dev` on a non-default PORT: start.sh derives
# LW_GATEWAY_BASE_URL=localhost:$(PORT+1000) and exports it before
# launching the gateway, but a flat `. .env` would clobber it back to
# the hardcoded default and the gateway would hit a dead control-plane
# port (every VK call → 401 invalid_api_key).
#
# For a standalone run (no pnpm dev in the ancestry, so nothing pre-derived
# LW_GATEWAY_BASE_URL) dev/scripts/lib/derive-gateway-base-url.sh derives it
# from PORT the same way start.sh does, once .env has had its say. Without
# this, a bare `make service svc=aigateway` on a non-default-PORT worktree
# silently falls through to services/aigateway/config.go's compatibility
# default (http://localhost:5560), correct only for a single worktree on
# the default port, and wrong everywhere else with no error anywhere: the
# gateway still proxies LLM traffic and returns 200, it just ships spend,
# budget and auth traffic to whichever control plane that port belongs to.
DEV_ENV_FILE ?= .env
service:
	@test -n "$(svc)" || (echo "usage: make service svc=<name>" && exit 1)
	@_snap=$$(export -p) && \
		{ test -f $(DEV_ENV_FILE) \
			&& set -a && . $(DEV_ENV_FILE) && set +a \
			|| echo "$(DEV_ENV_FILE) not found — using process environment"; } && \
		eval "$$_snap" && \
		. dev/scripts/lib/derive-gateway-base-url.sh && derive_gateway_base_url && \
		export LOG_FORMAT=pretty && \
		exec go run ./cmd/service $(svc)

# Run a Go service with live reload on file changes.
# Usage: make service-watch svc=aigateway
service-watch:
	@test -n "$(svc)" || (echo "usage: make watch svc=<name>" && exit 1)
	@test -f $(DEV_ENV_FILE) || (echo "$(DEV_ENV_FILE) not found — seed .env first" && exit 1)
	@which air > /dev/null 2>&1 || (echo "Installing air..." && go install github.com/air-verse/air@latest)
	@_snap=$$(export -p) && \
		set -a && . $(DEV_ENV_FILE) && set +a && \
		eval "$$_snap" && \
		. dev/scripts/lib/derive-gateway-base-url.sh && derive_gateway_base_url && \
		export LOG_FORMAT=pretty && \
		air --build.cmd "go build -o ./tmp/$(svc) ./cmd/service" \
			--build.bin "./tmp/$(svc) $(svc)" \
			--build.include_ext "go" \
			--build.exclude_dir "tmp,vendor,node_modules"

# The dev* shim targets were removed in #4053. Use `make quickstart`
# (interactive) or `./dev/scripts/dev.sh <preset>` directly. Preset list:
# all-local, all-local-nlp, dev-storage, dev-infra, frontend-only,
# migration, full-local.

# Refresh AWS SSO credentials in .env so `make quickstart
# dev-storage` can talk to runtime-storage-dev. SSO temporary tokens
# expire ~hourly; this rotates the three S3_*_KEY/TOKEN lines in
# .env, leaving S3_BUCKET_NAME/S3_ENDPOINT/S3_REGION alone.
refresh-dev-s3:
	@bash dev/scripts/refresh-dev-s3-env.sh

# Run all *.unit.bats tests under dev/scripts/__tests__/. Dev-only — these
# tests cover shell behavior of `dev.sh` / `write-dev-overrides.sh` /
# `worktree.sh` / `boxd-fork.sh`. CI does NOT run them; the launchers
# are local dev tools, not part of the shipped product. If you're
# editing one of those scripts, run `make test-scripts` to verify.
#
# Requires `bats` (`brew install bats-core` on macOS,
# `sudo apt-get install -y bats` on Linux).
#
# Globs only *.unit.bats — the *.integration.bats files shell out to
# git / docker / external CLIs against the real filesystem and need
# fixtures.
test-scripts:
	@if ! command -v bats >/dev/null 2>&1; then \
		echo "ERROR: bats not installed. Install with:" >&2; \
		echo "  macOS:  brew install bats-core" >&2; \
		echo "  Linux:  sudo apt-get install -y bats" >&2; \
		exit 1; \
	fi
	bats dev/scripts/__tests__/*.unit.bats

# Mirror the Go services' herr error codes into
# packages/handled-error/src/codes.generated.ts, so the TypeScript control
# plane stops compiling when a Go service gains a code with no presentation.
# Run after adding or renaming a `herr.Code(...)` const. `herrgen-check` is the
# drift check, and go-ci.yaml's `generated` job calls this same target, so what
# CI runs and what you run cannot drift apart.
herrgen:
	@go run ./cmd/herrgen

herrgen-check:
	@go run ./cmd/herrgen -check
# ── Deterministic house rules ──────────────────────────────────────────────
#
# The ast-grep and semgrep rulesets encode house rules that used to be
# enforced only by the AI reviewer, once per PR, as a comment. They are
# ordinary linters; these targets are how a human runs them.
#
# Versions are PINNED to what .github/workflows/coderabbit-config-check.yml
# uses — rule-matching behaviour is version-sensitive. Bump both together.
AST_GREP_VERSION := 0.42.3
SEMGREP_VERSION  := 1.164.0
GOLANGCI_VERSION := v2.11.4

# Resolve the pinned tools without caring how the developer installs Python
# tools. `uv` is preferred (isolated, no venv juggling); an already-correct
# binary on PATH is accepted; otherwise we say exactly what to run.
define _need_astgrep
	@if command -v ast-grep >/dev/null 2>&1 && \
	    ast-grep --version 2>/dev/null | grep -q "$(AST_GREP_VERSION)"; then :; \
	elif command -v uv >/dev/null 2>&1; then :; \
	else \
		echo "ERROR: ast-grep $(AST_GREP_VERSION) not found and uv is unavailable." >&2; \
		echo "  brew install uv   # then re-run; uv fetches the pinned version" >&2; \
		echo "  or: pipx install 'ast-grep-cli==$(AST_GREP_VERSION)'" >&2; \
		exit 1; \
	fi
endef

# uvx runs the pinned version without installing it globally, so a developer
# with a different ast-grep on PATH still gets the CI behaviour.
AST_GREP := $(shell if command -v ast-grep >/dev/null 2>&1 && ast-grep --version 2>/dev/null | grep -q "$(AST_GREP_VERSION)"; then echo ast-grep; else echo "uvx --from ast-grep-cli==$(AST_GREP_VERSION) ast-grep"; fi)
SEMGREP  := $(shell if command -v semgrep >/dev/null 2>&1; then echo semgrep; else echo "uvx --from semgrep==$(SEMGREP_VERSION) semgrep"; fi)

lint-rules:
	$(call _need_astgrep)
	@echo "==> ast-grep (dev/lint/ast-grep/rules)"
	@$(AST_GREP) scan -c dev/lint/ast-grep/sgconfig.yml
	@echo "==> semgrep (dev/lint/semgrep/langwatch.yml)"
	@$(SEMGREP) --config dev/lint/semgrep/langwatch.yml --quiet --error .

# What CI gates on. Scans only files this branch changed, so a large
# pre-existing baseline never blocks work on an unrelated file.
lint-rules-changed:
	$(call _need_astgrep)
	@files=$$(git diff --name-only --diff-filter=ACMR origin/main...HEAD -- '*.ts' '*.tsx'); \
	if [ -z "$$files" ]; then echo "No changed TS/TSX files."; exit 0; fi; \
	echo "==> ast-grep over $$(echo "$$files" | wc -l | tr -d ' ') changed file(s)"; \
	$(AST_GREP) scan -c dev/lint/ast-grep/sgconfig.yml $$files

lint-rules-test:
	$(call _need_astgrep)
	@cd dev/lint/ast-grep && $(AST_GREP) test -c sgconfig.yml -t rule-tests

# golangci-lint's config is version: "2"; a v1 binary refuses it outright,
# which is why "run the Go checks before pushing" quietly stopped happening.
# Always resolve the pinned version rather than trusting PATH.
GOLANGCI := $(shell if command -v golangci-lint >/dev/null 2>&1 && golangci-lint --version 2>/dev/null | grep -q "$(patsubst v%,%,$(GOLANGCI_VERSION))"; then echo golangci-lint; else echo "go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_VERSION)"; fi)
GO_LINT_PKGS := ./services/aigateway/... ./services/langyagent/... ./services/nlpgo/... ./pkg/... ./cmd/... ./tools/...

go-lint:
	@echo "==> golangci-lint $(GOLANGCI_VERSION)"
	@$(GOLANGCI) run $(GO_LINT_PKGS)

go-lint-changed:
	@echo "==> golangci-lint $(GOLANGCI_VERSION) (new/changed lines only)"
	@$(GOLANGCI) run --new-from-merge-base=origin/main $(GO_LINT_PKGS)

# Stop all services
down:
ifneq (haven,$(firstword $(MAKECMDGOALS)))
	$(COMPOSE) --profile full down
else
	@:
endif

# Tail logs
logs:
	$(COMPOSE) --profile full logs -f

# Show running services
ps:
	$(COMPOSE) --profile full ps

# Remove volumes (reset all data)
clean:
	$(COMPOSE) --profile full down -v

# =============================================================================
# LEGACY COMMANDS (run services locally, not in Docker)
# =============================================================================

# Guarded so `make haven install` (which go-installs the haven CLI via the
# `haven` target in dev/haven.mk) doesn't ALSO run pnpm install: when `haven`
# is the first goal this recipe is a no-op. Plain `make install` is unaffected.
install:
ifneq (haven,$(firstword $(MAKECMDGOALS)))
	pnpm install
else
	@:
endif

# The whole local stack in one terminal: the three applications (ui, api,
# workers) plus the Go aigateway and nlpgo engines. `pnpm dev` starts all five
# itself now — dev/scripts/dev-stack.sh derives every port and skips a Go lane
# that is already listening — so this target is one line pointing at it, kept
# because `make start` is in the README and in muscle memory.
start:
	pnpm dev

start/postgres:
	@echo "Starting Postgres..."
	@docker compose -f infra/compose.yml --project-directory . up -d postgres

# A watching typecheck of one application (default apps/api):
#   make tsc-watch app=apps/ui
# It never takes a check-queue slot — a `--watch` run would hold one for the
# whole session, which is exactly what the queue exists to prevent.
tsc-watch:
	pnpm exec tsc --noEmit --watch --preserveWatchOutput -p $(or $(app),apps/api)/tsconfig.json

# Single entry point — interactive launcher or non-interactive mode runner.
# (#3860 AC#1, AC#2). Positional usage via MAKECMDGOALS:
#   make quickstart                  # interactive prompt
#   make quickstart frontend-only    # no compose, fastest
#   make quickstart backend-shared   # postgres + redis + clickhouse + app
#   make quickstart migration        # postgres + clickhouse on host ports
#   make quickstart nlp              # backend + nlp + langevals
#   make quickstart full-local       # --profile full
ifeq (quickstart,$(firstword $(MAKECMDGOALS)))
  QUICKSTART_ARG := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  # The eval below silently overrides whatever name the user passed with a
  # no-op recipe. If they pass an existing target name (e.g. `help`, `down`,
  # `logs`), make would happily overwrite the real recipe and run the empty
  # one — so we error out explicitly with a hint instead.
  ifneq ($(filter $(QUICKSTART_ARG),help dev dev-up dev-down dev-logs dev-nlp dev-scenarios dev-test dev-full down logs clean ps quickstart quickstart-help worktree start),)
    $(error 'make quickstart $(QUICKSTART_ARG)' collides with target '$(QUICKSTART_ARG)' — use `make quickstart-help` for the mode reference, or pass a mode like `frontend-only` / `backend-shared` / `nlp` / `migration` / `full-local`)
  endif
  ifneq ($(QUICKSTART_ARG),)
    $(eval $(QUICKSTART_ARG):;@:)
  endif
endif
quickstart:
	@./dev/scripts/dev.sh $(QUICKSTART_ARG)

# Non-interactive mode reference (#3860 AC#8). Use `make quickstart-help` —
# `make quickstart help` collides with the existing `help` target.
quickstart-help:
	@./dev/scripts/dev.sh help

# =============================================================================
# ISOLATED DEV INSTANCES (for AI agents / parallel worktrees)
# =============================================================================
# Each worktree gets its own containers, volumes, and ports.
# Port info saved to .dev-port for agent/skill discovery.

# Deprecation warning for dev-up / dev-down / dev-logs (#3860 AC#9).
_dev-up-deprecation-warning:
	@printf '\033[33m[deprecated] make %s → make quickstart (single entry point)\033[0m\n' "$(MAKECMDGOALS)" >&2

# Start isolated instance (detached). Usage: make dev-up [PROFILE=scenarios]
dev-up: _dev-up-deprecation-warning
	@./dev/scripts/dev-up.sh $(PROFILE)

# Stop isolated instance
dev-down: _dev-up-deprecation-warning
	@./dev/scripts/dev-down.sh

# Tail logs for isolated instance
dev-logs: _dev-up-deprecation-warning
	@if [ -f .dev-port ]; then . ./.dev-port && COMPOSE_PROJECT_NAME=$$COMPOSE_PROJECT_NAME VOLUME_PREFIX=$$VOLUME_PREFIX docker compose -f dev/compose.dev.yml --project-directory . --profile full logs -f; \
	else echo "No .dev-port found. Is the instance running?"; fi

# Create a git worktree from issue number or feature name
# Usage: make worktree 1663  or  make worktree add-dark-mode
ifeq (worktree,$(firstword $(MAKECMDGOALS)))
  WORKTREE_ARG := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  $(eval $(WORKTREE_ARG):;@:)
endif
worktree:
	@./dev/scripts/worktree.sh $(WORKTREE_ARG)

# Describe the REST surface the API process actually mounts, and say how it
# differs from the frozen document.
#
# The DOCUMENT IS FROZEN. `apps/api/src/features/discovery/openapi-document.json`
# is served by three routes and both SDKs generate clients from it, so nothing
# here writes it — not this target, not the task it runs. What the generator
# produces goes to a scratch file, and the check prints what a person would
# have to look at before replacing the artifact by hand.
#
# To regenerate the CLIENTS from the document as it stands, run the two
# commands the output names.
sync-all-openapi:
	@pnpm --filter @langwatch/platform-api task:openapi-check
	@echo ""
	@echo "The frozen document was NOT written. To refresh the clients from it as it stands:"
	@echo "    cd sdks/typescript && pnpm run generate:openapi-types"
	@echo "    cd sdks/python && make generate/api-client"

# Included last on purpose (see the note next to `include dev/boxd.mk`): the
# `make haven <sub>` passthrough must define its no-op goals after the real
# `down` / `install` targets so its override wins.
include dev/haven.mk

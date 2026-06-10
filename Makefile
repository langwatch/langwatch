.PHONY: help start sync-all-openapi user-delete-dry-run user-delete es-delete-dry-run es-delete
.PHONY: down logs clean ps quickstart quickstart-help worktree refresh-dev-s3
.PHONY: dev-up dev-down dev-logs setup-hooks service service-watch test-scripts
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
	@echo "    make quickstart full-local          kitchen-sink local (dedicated workers container + bullboard + ai-server)"
	@echo "    make quickstart-help                non-interactive preset reference"
	@echo "    make service svc=<name>             run a Go service (e.g. aigateway)"
	@echo "    make service-watch svc=<name>       run a Go service with live reload (air)"
	@echo "    make worktree <issue|name>          create a git worktree for an issue/feature"
	@echo "    make down                           stop all services"
	@echo "    make test-scripts                   run bats unit tests under scripts/__tests__/"
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

include boxd.mk

# =============================================================================
# DOCKER DEV ENVIRONMENT (compose.dev.yml)
# =============================================================================
# All services run in Docker with resource limits.
# App is volume-mounted for hot reload.

COMPOSE = docker compose -f compose.dev.yml

# Sources scripts/lib/sanitize-dev-env.sh and rewrites stale localhost-pinned
# NEXTAUTH_URL / BASE_HOST exports to the compose-derived APP_PORT (default
# 5560). Real overrides like boxd-proxy URLs are left untouched. Prepended
# to every dev `up` recipe so `make dev*` paths can't silently 403 on login
# if a previous session leaked the env (lw#3453).
SANITIZE_DEV_ENV = APP_PORT=$${APP_PORT:-5560} . scripts/lib/sanitize-dev-env.sh && sanitize_localhost_dev_env

# Install git hooks (idempotent, runs automatically before dev targets)
setup-hooks:
	@git config core.hooksPath .githooks 2>/dev/null || true

# Run a Go service via the mono-binary.
# Usage: make service svc=aigateway
#
# Sources every var from langwatch/.env into the Go process's environment.
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
DEV_ENV_FILE ?= langwatch/.env
service:
	@test -n "$(svc)" || (echo "usage: make service svc=<name>" && exit 1)
	@_snap=$$(export -p) && \
		{ test -f $(DEV_ENV_FILE) \
			&& set -a && . $(DEV_ENV_FILE) && set +a \
			|| echo "$(DEV_ENV_FILE) not found — using process environment"; } && \
		eval "$$_snap" && \
		export LOG_FORMAT=pretty && \
		exec go run ./cmd/service $(svc)

# Run a Go service with live reload on file changes.
# Usage: make service-watch svc=aigateway
service-watch:
	@test -n "$(svc)" || (echo "usage: make watch svc=<name>" && exit 1)
	@test -f $(DEV_ENV_FILE) || (echo "$(DEV_ENV_FILE) not found — seed langwatch/.env first" && exit 1)
	@which air > /dev/null 2>&1 || (echo "Installing air..." && go install github.com/air-verse/air@latest)
	@_snap=$$(export -p) && \
		set -a && . $(DEV_ENV_FILE) && set +a && \
		eval "$$_snap" && \
		export LOG_FORMAT=pretty && \
		air --build.cmd "go build -o ./tmp/$(svc) ./cmd/service" \
			--build.bin "./tmp/$(svc) $(svc)" \
			--build.include_ext "go" \
			--build.exclude_dir "tmp,vendor,node_modules"

# The dev* shim targets were removed in #4053. Use `make quickstart`
# (interactive) or `./scripts/dev.sh <preset>` directly. Preset list:
# all-local, all-local-nlp, dev-storage, dev-infra, frontend-only,
# migration, full-local.

# Refresh AWS SSO credentials in langwatch/.env so `make quickstart
# dev-storage` can talk to runtime-storage-dev. SSO temporary tokens
# expire ~hourly; this rotates the three S3_*_KEY/TOKEN lines in
# langwatch/.env, leaving S3_BUCKET_NAME/S3_ENDPOINT/S3_REGION alone.
refresh-dev-s3:
	@bash langwatch/scripts/refresh-dev-s3-env.sh

# Run all *.unit.bats tests under scripts/__tests__/. Dev-only — these
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
	bats scripts/__tests__/*.unit.bats

# Stop all services
down:
	$(COMPOSE) --profile full down

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

install:
	cd langwatch && pnpm install

# Run the app (pnpm dev, which also auto-starts the Go aigateway) alongside
# the Go nlpgo engine. nlpgo is the `nlpgo` subcommand of the cmd/service
# monobinary, run the same way as aigateway (`make service svc=nlpgo`). We pin
# SERVER_ADDR=:5561 so it binds the port the app expects (LANGWATCH_NLP_SERVICE
# → http://localhost:5561) and doesn't collide with langevals on :5562.
# LANGWATCH_ENDPOINT points nlpgo's evaluator/agent-workflow callbacks back at
# the local app.
start:
	cd langwatch && pnpm concurrently --kill-others \
		'pnpm dev' \
		'SERVER_ADDR=:5561 LANGWATCH_ENDPOINT=http://localhost:5560 make -C .. service svc=nlpgo'

start/postgres:
	@echo "Starting Postgres..."
	@docker compose up -d postgres

tsc-watch:
	cd langwatch && pnpm tsc-watch

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
	@./scripts/dev.sh $(QUICKSTART_ARG)

# Non-interactive mode reference (#3860 AC#8). Use `make quickstart-help` —
# `make quickstart help` collides with the existing `help` target.
quickstart-help:
	@./scripts/dev.sh help

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
	@./scripts/dev-up.sh $(PROFILE)

# Stop isolated instance
dev-down: _dev-up-deprecation-warning
	@./scripts/dev-down.sh

# Tail logs for isolated instance
dev-logs: _dev-up-deprecation-warning
	@if [ -f .dev-port ]; then . ./.dev-port && COMPOSE_PROJECT_NAME=$$COMPOSE_PROJECT_NAME VOLUME_PREFIX=$$VOLUME_PREFIX docker compose -f compose.dev.yml --profile full logs -f; \
	else echo "No .dev-port found. Is the instance running?"; fi

# Create a git worktree from issue number or feature name
# Usage: make worktree 1663  or  make worktree add-dark-mode
ifeq (worktree,$(firstword $(MAKECMDGOALS)))
  WORKTREE_ARG := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  $(eval $(WORKTREE_ARG):;@:)
endif
worktree:
	@./scripts/worktree.sh $(WORKTREE_ARG)

sync-all-openapi:
	pnpm run task generateOpenAPISpec
	cd typescript-sdk && pnpm run generate:openapi-types
	cd python-sdk && make generate/api-client

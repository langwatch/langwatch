.PHONY: help start sync-all-openapi user-delete-dry-run user-delete es-delete-dry-run es-delete
.PHONY: dev dev-nlp dev-scenarios dev-full down logs clean ps quickstart quickstart-help worktree
.PHONY: dev-up dev-down dev-logs setup-hooks service service-watch
.PHONY: _dev-deprecation-warning _dev-up-deprecation-warning

# Surface every target — boxd-* are pulled in via include below.
help:
	@echo "LangWatch dev targets:"
	@echo ""
	@echo "  Primary (Docker dev environment):"
	@echo "    make quickstart                     interactive — asks 'what are you working on?'"
	@echo "    make quickstart frontend-only       no compose; pure pnpm dev against your .env URLs"
	@echo "    make quickstart backend-shared      postgres + redis + clickhouse + app, URLs → local"
	@echo "    make quickstart migration           postgres + clickhouse on host ports (prisma migrate)"
	@echo "    make quickstart nlp                 backend + langwatch_nlp + langevals"
	@echo "    make quickstart full-local          everything (--profile full)"
	@echo "    make quickstart-help                non-interactive mode reference"
	@echo "    make service svc=<name>             run a Go service (e.g. aigateway)"
	@echo "    make service-watch svc=<name>       run a Go service with live reload (air)"
	@echo "    make worktree <issue|name>          create a git worktree for an issue/feature"
	@echo "    make down                           stop all services"
	@echo ""
	@echo "  Boxd workflows (multi-step orchestration over the boxd CLI):"
	@echo "    make boxd-help                      full boxd target reference"
	@echo "    make boxd-golden                    create the canonical base VM"
	@echo "    make boxd-fork-pr PR=<n>            fork golden for an existing PR"
	@echo "    make boxd-fork-branch BRANCH=<n>    fork golden for a branch"
	@echo "    make boxd-fork-issue ISSUE=<n>      fork + worktree + tmux+claude in VM"
	@echo "    make boxd-connect-{pr,branch,issue} <ARG>=<v>   attach to the in-VM session"
	@echo ""
	@echo "  Deprecated (use 'make quickstart' — kept for one release):"
	@echo "    make dev / dev-nlp / dev-scenarios / dev-test / dev-full"
	@echo "    make dev-up / dev-down / dev-logs"
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
DEV_ENV_FILE ?= langwatch/.env
service:
	@test -n "$(svc)" || (echo "usage: make service svc=<name>" && exit 1)
	@test -f $(DEV_ENV_FILE) || (echo "$(DEV_ENV_FILE) not found — seed langwatch/.env first" && exit 1)
	@set -a && . $(DEV_ENV_FILE) && set +a && \
		export LOG_FORMAT=pretty && \
		exec go run ./cmd/service $(svc)

# Run a Go service with live reload on file changes.
# Usage: make service-watch svc=aigateway
service-watch:
	@test -n "$(svc)" || (echo "usage: make watch svc=<name>" && exit 1)
	@test -f $(DEV_ENV_FILE) || (echo "$(DEV_ENV_FILE) not found — seed langwatch/.env first" && exit 1)
	@which air > /dev/null 2>&1 || (echo "Installing air..." && go install github.com/air-verse/air@latest)
	@set -a && . $(DEV_ENV_FILE) && set +a && \
		export LOG_FORMAT=pretty && \
		air --build.cmd "go build -o ./tmp/$(svc) ./cmd/service" \
			--build.bin "./tmp/$(svc) $(svc)" \
			--build.include_ext "go" \
			--build.exclude_dir "tmp,vendor,node_modules"

# Deprecation warning for dev* targets — kept for one release. (#3860 AC#9)
# Each maps onto the equivalent quickstart mode so the URL-override behavior
# is consistent regardless of which alias the user invoked.
_dev-deprecation-warning:
	@printf '\033[33m[deprecated] make %s → make quickstart (or ./scripts/dev.sh <mode>)\033[0m\n' "$(MAKECMDGOALS)" >&2
	@printf 'See: dev/docs/adr/004-docker-dev-environment.md\n' >&2

dev: _dev-deprecation-warning
	@./scripts/dev.sh backend-shared

dev-nlp: _dev-deprecation-warning
	@./scripts/dev.sh nlp

dev-scenarios: _dev-deprecation-warning
	@./scripts/dev.sh full-local

dev-test: _dev-deprecation-warning
	@./scripts/dev.sh full-local

dev-full: _dev-deprecation-warning
	@./scripts/dev.sh full-local

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
	cd langwatch_nlp && make install

start:
	cd langwatch && pnpm concurrently --kill-others 'pnpm dev' 'cd ../langwatch_nlp && make start'

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

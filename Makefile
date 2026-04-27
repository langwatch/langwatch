.PHONY: start sync-all-openapi user-delete-dry-run user-delete es-delete-dry-run es-delete
.PHONY: dev dev-nlp dev-scenarios dev-full down logs clean ps quickstart worktree
.PHONY: dev-up dev-down dev-logs setup-hooks service service-watch

# =============================================================================
# DOCKER DEV ENVIRONMENT (compose.dev.yml)
# =============================================================================
# All services run in Docker with resource limits.
# App is volume-mounted for hot reload.

COMPOSE = docker compose -f compose.dev.yml

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

# Minimal: postgres + redis + clickhouse + app
dev:
	$(COMPOSE) up

# + NLP service + langevals (for evaluations)
dev-nlp:
	$(COMPOSE) --profile nlp up

# + scenario worker + bullboard + NLP
dev-scenarios:
	$(COMPOSE) --profile scenarios up

# + AI test server (for HTTP agent testing)
dev-test:
	$(COMPOSE) --profile test up

# Everything
dev-full:
	$(COMPOSE) --profile full up

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

python-build:
	uv pip install build && uv run python -m build

python-install:
	pip install --no-cache-dir --force-reinstall dist/langwatch_server-*-py3-none-any.whl

start/postgres:
	@echo "Starting Postgres..."
	@docker compose up -d postgres

tsc-watch:
	cd langwatch && pnpm tsc-watch

# Interactive profile chooser
quickstart:
	@./scripts/dev.sh

# =============================================================================
# ISOLATED DEV INSTANCES (for AI agents / parallel worktrees)
# =============================================================================
# Each worktree gets its own containers, volumes, and ports.
# Port info saved to .dev-port for agent/skill discovery.

# Start isolated instance (detached). Usage: make dev-up [PROFILE=scenarios]
dev-up:
	@./scripts/dev-up.sh $(PROFILE)

# Stop isolated instance
dev-down:
	@./scripts/dev-down.sh

# Tail logs for isolated instance
dev-logs:
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

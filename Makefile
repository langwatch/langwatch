.PHONY: start sync-all-openapi user-delete-dry-run user-delete es-delete-dry-run es-delete
.PHONY: dev dev-nlp dev-scenarios dev-full down logs clean ps quickstart worktree

# =============================================================================
# DOCKER DEV ENVIRONMENT (compose.dev.yml)
# =============================================================================
# All services run in Docker with resource limits.
# App is volume-mounted for hot reload.

COMPOSE = docker compose -f compose.dev.yml

# Minimal: postgres + redis + app (no opensearch)
dev:
	$(COMPOSE) up

# + opensearch (for traces/search features)
dev-search:
	$(COMPOSE) --profile search up

# + NLP service + langevals (for evaluations)
dev-nlp:
	$(COMPOSE) --profile nlp up

# + scenario worker + bullboard + NLP (no opensearch needed)
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
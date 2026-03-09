.PHONY: start sync-all-openapi user-delete-dry-run user-delete es-delete-dry-run es-delete
.PHONY: dev dev-nlp dev-scenarios dev-full down logs clean ps quickstart worktree
.PHONY: setup-hooks
.PHONY: test-e2e test-e2e-up test-e2e-down

# =============================================================================
# DOCKER DEV ENVIRONMENT (compose.dev.yml)
# =============================================================================
# All services run in Docker with resource limits.
# App is volume-mounted for hot reload.

COMPOSE = docker compose -f compose.dev.yml

# Install git hooks (idempotent, runs automatically before dev targets)
setup-hooks:
	@cp .githooks/post-checkout .git/hooks/post-checkout 2>/dev/null || true

# Minimal: postgres + redis + app (no opensearch)
dev: setup-hooks
	$(COMPOSE) up

# + opensearch (for traces/search features)
dev-search: setup-hooks
	$(COMPOSE) --profile search up

# + NLP service + langevals (for evaluations)
dev-nlp: setup-hooks
	$(COMPOSE) --profile nlp up

# + scenario worker + bullboard + NLP (no opensearch needed)
dev-scenarios: setup-hooks
	$(COMPOSE) --profile scenarios up

# + AI test server (for HTTP agent testing)
dev-test: setup-hooks
	$(COMPOSE) --profile test up

# Everything
dev-full: setup-hooks
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

# =============================================================================
# E2E TESTING (agentic-e2e-tests/)
# =============================================================================
# Runs Playwright E2E tests against an isolated test environment.
# Infrastructure runs in Docker on isolated ports; the app runs on the host.
#
# Ports: app=5570, postgres=5433, redis=6380, opensearch=9201

E2E_COMPOSE = docker compose -f agentic-e2e-tests/compose.yml

# Start infrastructure only (postgres, redis, opensearch) — no app container
test-e2e-up:
	$(E2E_COMPOSE) up -d postgres redis opensearch
	@echo "Waiting for services to be healthy..."
	@$(E2E_COMPOSE) exec postgres sh -c 'until pg_isready -U prisma -d testdb; do sleep 1; done' 2>/dev/null
	@echo "Infrastructure is ready."

# Stop e2e infrastructure
test-e2e-down:
	$(E2E_COMPOSE) down

# Run the full e2e test lifecycle
# 1. Start infrastructure  2. Migrate DB  3. Build app  4. Run tests  5. Teardown
test-e2e: test-e2e-up
	@echo "=== Running database migrations ==="
	cd langwatch && DATABASE_URL="postgresql://prisma:prisma@localhost:5433/testdb?schema=testdb" pnpm prisma:migrate
	@echo "=== Preparing files ==="
	cd langwatch && pnpm start:prepare:files
	@echo "=== Building app ==="
	cd langwatch && NODE_ENV=test SKIP_ENV_VALIDATION=true pnpm build
	@echo "=== Installing E2E test dependencies ==="
	cd agentic-e2e-tests && pnpm install
	cd agentic-e2e-tests && pnpm exec playwright install --with-deps chromium
	@echo "=== Starting app and running tests ==="
	@cd langwatch && \
		DATABASE_URL="postgresql://prisma:prisma@localhost:5433/testdb?schema=testdb" \
		REDIS_URL="redis://localhost:6380" \
		ELASTICSEARCH_NODE_URL="http://localhost:9201" \
		IS_OPENSEARCH="true" \
		NEXTAUTH_SECRET="test-secret-for-e2e" \
		NEXTAUTH_URL="http://localhost:5570" \
		API_TOKEN_JWT_SECRET="test-jwt-secret-for-e2e" \
		SKIP_ENV_VALIDATION="true" \
		DISABLE_PII_REDACTION="true" \
		SKIP_CLICKHOUSE_MIGRATE="true" \
		PORT=5570 \
		node_modules/.bin/next start -p 5570 & \
	APP_PID=$$!; \
	trap 'kill $$APP_PID 2>/dev/null; $(MAKE) test-e2e-down' EXIT; \
	sleep 5; \
	cd agentic-e2e-tests && BASE_URL="http://localhost:5570" pnpm test; \
	TEST_EXIT=$$?; \
	kill $$APP_PID 2>/dev/null; \
	$(MAKE) test-e2e-down; \
	exit $$TEST_EXIT

sync-all-openapi:
	pnpm run task generateOpenAPISpec
	cd typescript-sdk && pnpm run generate:openapi-types
	cd python-sdk && make generate/api-client
.PHONY: start sync-all-openapi quickstart user-delete-dry-run user-delete es-delete-dry-run es-delete


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

quickstart:
	@echo "Starting Langwatch..."
	@docker compose up redis postgres -d
	make install
	make start
	open http://localhost:5560

sync-all-openapi:
	pnpm run task generateOpenAPISpec
	cd typescript-sdk && pnpm run generate:openapi-types
	cd python-sdk && make generate/api-client

# GDPR/Compliance: Dry run user deletion (shows what would be deleted)
# Deletes: Postgres data + Elasticsearch data (traces, evals, etc.) for sole-owned projects
# Usage: make user-delete-dry-run EMAIL=user@example.com
# Recommended usage with .env.gdpr file: set -a && source langwatch/.env.gdpr && ...
user-delete-dry-run:
ifndef EMAIL
	$(error EMAIL is required. Usage: make user-delete-dry-run EMAIL=user@example.com)
endif
	@cd langwatch && SKIP_REDIS=1 pnpm run task gdpr/deleteUserData $(EMAIL)

# GDPR/Compliance: Execute user deletion (requires confirmation)
# Deletes: Postgres data + Elasticsearch data (traces, evals, etc.) for sole-owned projects
# Usage: make user-delete EMAIL=user@example.com
# Recommended usage with .env.gdpr file: set -a && source langwatch/.env.gdpr && ...
user-delete:
ifndef EMAIL
	$(error EMAIL is required. Usage: make user-delete EMAIL=user@example.com)
endif
	@cd langwatch && SKIP_REDIS=1 pnpm run task gdpr/deleteUserData $(EMAIL) --execute

# GDPR/Compliance: Dry run ES-only deletion by project ID (standalone, not tied to user)
# Deletes: traces, dspy-steps, batch-evaluations, scenario-events
# Usage: make es-delete-dry-run PROJECT_ID=proj_123
#        make es-delete-dry-run PROJECT_ID=proj_123,proj_456  (multiple)
# Recommended usage with .env.gdpr file: set -a && source langwatch/.env.gdpr && ...
es-delete-dry-run:
ifndef PROJECT_ID
	$(error PROJECT_ID is required. Usage: make es-delete-dry-run PROJECT_ID=proj_123)
endif
	@cd langwatch && SKIP_REDIS=1 pnpm run task gdpr/deleteProjectEsData $(PROJECT_ID)

# GDPR/Compliance: Execute ES-only deletion by project ID (standalone, not tied to user)
# Deletes: traces, dspy-steps, batch-evaluations, scenario-events
# Usage: make es-delete PROJECT_ID=proj_123
# Recommended usage with .env.gdpr file: set -a && source langwatch/.env.gdpr && ...
es-delete:
ifndef PROJECT_ID
	$(error PROJECT_ID is required. Usage: make es-delete PROJECT_ID=proj_123)
endif
	@cd langwatch && SKIP_REDIS=1 pnpm run task gdpr/deleteProjectEsData $(PROJECT_ID) --execute
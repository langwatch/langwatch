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
# Usage: make user-delete-dry-run EMAIL=user@example.com
user-delete-dry-run:
ifndef EMAIL
	$(error EMAIL is required. Usage: make user-delete-dry-run EMAIL=user@example.com)
endif
	@cd langwatch && set -a && source .env && ./scripts/user-delete.sh $(EMAIL)

# GDPR/Compliance: Execute user deletion (requires confirmation)
# Usage: make user-delete EMAIL=user@example.com
user-delete:
ifndef EMAIL
	$(error EMAIL is required. Usage: make user-delete EMAIL=user@example.com)
endif
	@cd langwatch && set -a && source .env && ./scripts/user-delete.sh $(EMAIL) --execute

# GDPR/Compliance: Dry run ES project deletion (shows what would be deleted)
# Usage: make es-delete-dry-run PROJECT_ID=proj_123
#        make es-delete-dry-run PROJECT_ID=proj_123,proj_456  (multiple)
es-delete-dry-run:
ifndef PROJECT_ID
	$(error PROJECT_ID is required. Usage: make es-delete-dry-run PROJECT_ID=proj_123)
endif
	@cd langwatch && set -a && source .env && ./scripts/es-project-delete.sh $(PROJECT_ID)

# GDPR/Compliance: Execute ES project deletion (requires confirmation)
# Usage: make es-delete PROJECT_ID=proj_123
es-delete:
ifndef PROJECT_ID
	$(error PROJECT_ID is required. Usage: make es-delete PROJECT_ID=proj_123)
endif
	@cd langwatch && set -a && source .env && ./scripts/es-project-delete.sh $(PROJECT_ID) --execute
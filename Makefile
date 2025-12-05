.PHONY: start sync-all-openapi quickstart


install:
	pnpm install
	cd langwatch_nlp && make install

start:
	pnpm exec concurrently --kill-others 'pnpm --filter langwatch run dev' 'cd langwatch_nlp && make start'

python-build:
	uv pip install build && uv run python -m build

python-install:
	pip install --no-cache-dir --force-reinstall dist/langwatch_server-*-py3-none-any.whl

start/postgres:
	@echo "Starting Postgres..."
	@docker compose up -d postgres

tsc-watch:
	pnpm --filter langwatch run tsc-watch

quickstart: 
	@echo "Starting Langwatch..."
	@docker compose up redis postgres -d
	make install
	make start
	open http://localhost:5560

sync-all-openapi:
	pnpm --filter langwatch run task generateOpenAPISpec
	pnpm --filter langwatch run generate:openapi-types
	cd python-sdk && make generate/api-client
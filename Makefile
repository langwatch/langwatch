.PHONY: start sync-all-openapi quickstart


install:
	cd langwatch && npm install
	cd langwatch_nlp && make install

start:
	cd langwatch && ./node_modules/.bin/concurrently --kill-others 'npm run dev' 'cd ../langwatch_nlp && make start'

python-build:
	uv pip install build && uv run python -m build

python-install:
	pip install --no-cache-dir --force-reinstall dist/langwatch_server-*-py3-none-any.whl

start/postgres:
	@echo "Starting Postgres..."
	@docker compose up -d postgres

tsc-watch:
	cd langwatch && npm run tsc-watch

quickstart: 
	@echo "Starting Langwatch..."
	@docker compose up redis postgres opensearch -d
	make install
	make start
	open http://localhost:5560

sync-all-openapi:
	npm run task generateOpenAPISpec
	cd typescript-sdk && npm run generate:openapi-types
	cd python-sdk && make generate/api-client
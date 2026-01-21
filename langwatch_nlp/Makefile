.PHONY: test test-integration install lint format

test:
	PYTHONPATH=$$PYTHONPATH:. uv run pytest -s -m "not integration" -vv $(filter-out $@,$(MAKECMDGOALS))

test-integration:
	PYTHONPATH=$$PYTHONPATH:. uv run pytest -s -m integration $(filter-out $@,$(MAKECMDGOALS))

lint:
	uv run ruff check .
	uv run black --check .
	uv run isort --check-only .

format:
	uv run ruff check --fix .
	uv run black .
	uv run isort .

install: ensure-uv
	uv sync --all-extras && uv pip uninstall litellm-enterprise litellm-proxy-extras

ensure-uv:
	@if ! command -v uv &> /dev/null; then \
		curl -LsSf https://astral.sh/uv/install.sh | sh; \
	fi

start: install
	@echo "Starting the server..."
	@uv run --no-sync watchmedo auto-restart -p 'none' --signal SIGTERM -- \
		uvicorn langwatch_nlp.main:app --host 0.0.0.0 --port 5561 --timeout-keep-alive 70 \
		--reload --reload-dir . --reload-dir ../python-sdk $(filter-out $@,$(MAKECMDGOALS))

licenses:
	@echo "Generating licenses..."
	@uv run pip-licenses --summary
	@uv run pip-licenses --format=json --with-license-file > langwatch_nlp_licenses.json
	@echo "Full licenses report saved to langwatch_nlp_licenses.json"
.PHONY: test test-integration install

test:
	PYTHONPATH=$$PYTHONPATH:. uv run pytest -s -m "not integration" -vv $(filter-out $@,$(MAKECMDGOALS))

test-integration:
	PYTHONPATH=$$PYTHONPATH:. uv run pytest -s -m integration $(filter-out $@,$(MAKECMDGOALS))

install: ensure-uv
	uv sync --all-extras

ensure-uv:
	@if ! command -v uv &> /dev/null; then \
		curl -LsSf https://astral.sh/uv/install.sh | sh; \
	fi

start: install
	@echo "Starting the server..."
	@uv run watchmedo auto-restart -p 'none' --signal SIGTERM -- \
		uvicorn -- langwatch_nlp.main:app --host 0.0.0.0 --port 8080 --timeout-keep-alive 70 --reload $(filter-out $@,$(MAKECMDGOALS))

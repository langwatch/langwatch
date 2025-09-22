.PHONY: test test-tracing install example

test: test-tracing
	LANGWATCH_API_KEY="testkey" PYTHONPATH=$$PYTHONPATH:. uv run pytest -s -vv -m "not integration" -k "not test_example and not test_prompt_service_tracing and not test_prompt_tracing and not test_context and not test_tracing" $(filter-out $@,$(MAKECMDGOALS))

# Run tracing tests in isolation to avoid global OpenTelemetry state conflicts
test-tracing:
	@echo "Running prompt service tracing tests..."
	@LANGWATCH_API_KEY="testkey" PYTHONPATH=$$PYTHONPATH:. uv run pytest -s -vv tests/prompts/test_prompt_service_tracing.py
	@echo "Running prompt tracing tests..."
	@LANGWATCH_API_KEY="testkey" PYTHONPATH=$$PYTHONPATH:. uv run pytest -s -vv tests/prompts/test_prompt_tracing.py
	@echo "Running telemetry context tests..."
	@LANGWATCH_API_KEY="testkey" PYTHONPATH=$$PYTHONPATH:. uv run pytest -s -vv tests/telemetry/test_context.py
	@echo "Running telemetry tracing tests..."
	@LANGWATCH_API_KEY="testkey" PYTHONPATH=$$PYTHONPATH:. uv run pytest -s -vv tests/telemetry/test_tracing.py

# Test bot/chatbot examples (excludes CLI examples)
test-examples: cli-examples
	PYTHONPATH=$$PYTHONPATH:. uv run pytest tests/test_examples.py -p no:warnings -s -x $(filter-out $@,$(MAKECMDGOALS))

# Test CLI examples separately (they don't need mock messages)
cli-examples:
	@echo "Running CLI examples..."
	@for file in examples/cli/*.py; do \
		if [ -f "$$file" ]; then \
			echo "Running $$file..."; \
			PYTHONPATH=$$PYTHONPATH:. uv run python "$$file" || exit 1; \
		fi; \
	done
	@echo "All CLI examples completed successfully."

install:
	@if ! command -v uv &> /dev/null; then \
		curl -LsSf https://astral.sh/uv/install.sh | sh; \
	fi
	uv sync --all-groups --all-extras

build:
	uv pip install build
	uv run python -m build

example:
	@args="$(filter-out $@,$(MAKECMDGOALS))"; \
	if [[ $$args =~ "fastapi" ]]; then \
		uv run python $$args; \
	elif [[ $$args =~ "streamlit" ]]; then \
		uv run streamlit run $$args; \
	else \
		uv run chainlit run -w --port 9000 $$args; \
	fi

batch-evaluation-example:
	uv run python $(filter-out $@,$(MAKECMDGOALS))

ensure-openapi-python-client:
	@if ! command -v openapi-python-client &> /dev/null; then \
		uv pip install openapi-python-client; \
	fi

generate/api-client: ensure-openapi-python-client
	@echo "Deleting old API client..."
	@rm -rf src/langwatch/generated/langwatch_rest_api_client
	@echo "Building API client..."
	@mkdir -p .tmp/api-client
	uv run openapi-python-client generate \
		--path ../langwatch/src/app/api/openapiLangWatch.json \
		--output-path .tmp/api-client \
		--overwrite
	@echo "Copying necessary files to SDK..."
	@mkdir -p src/langwatch/generated/langwatch_rest_api_client
	@cp -r .tmp/api-client/lang_watch_api_client/ src/langwatch/generated/langwatch_rest_api_client/
	@echo "Cleaning up..."
	@rm -rf .tmp/api-client
	@echo "Done! API client has been integrated into the SDK."

%:
	@:

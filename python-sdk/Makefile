.PHONY: test install example

test:
	uv pip install strands-agents==0.1.4; \
	LANGWATCH_API_KEY="testkey" PYTHONPATH=$$PYTHONPATH:. uv run pytest -s -vv -m "not integration" $(filter-out $@,$(MAKECMDGOALS))

# Call it with `make test-examples -- -k examples/openai_bot.py` to run a specific example
test-examples:
	uv pip install strands-agents==0.1.4; \
	PYTHONPATH=$$PYTHONPATH:. uv run pytest tests/test_examples.py -p no:warnings -s -x $(filter-out $@,$(MAKECMDGOALS))

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
	uv pip install strands-agents; \
	if [[ $$args =~ "fastapi" ]]; then \
		uv run python $$args; \
	elif [[ $$args =~ "streamlit" ]]; then \
		uv run streamlit run $$args; \
	else \
		uv run chainlit run -w --port 9000 $$args; \
	fi

run/example:
	uv run python examples/openai_bot_prompt.py

batch-evaluation-example:
	uv run python $(filter-out $@,$(MAKECMDGOALS))

ensure-openapi-python-client:
	@if ! command -v openapi-python-client &> /dev/null; then \
		uv pip install openapi-python-client; \
	fi

generate/api-client: ensure-openapi-python-client
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

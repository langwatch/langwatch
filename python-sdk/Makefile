.PHONY: test install example

test:
	LANGWATCH_API_KEY="testkey" PYTHONPATH=$$PYTHONPATH:. poetry run pytest -s -vv -m "not integration" $(filter-out $@,$(MAKECMDGOALS))

install:
	@if ! command -v poetry &> /dev/null; then \
		curl -sSL https://install.python-poetry.org | python3 -; \
	fi
	poetry install --all-extras

example:
	@args="$(filter-out $@,$(MAKECMDGOALS))"; \
	if [[ $$args =~ "fastapi" ]]; then \
		poetry run python $$args; \
	elif [[ $$args =~ "streamlit" ]]; then \
		poetry run streamlit run $$args; \
	else \
		poetry run chainlit run -w --port 9000 $$args; \
	fi

batch-evaluation-example:
	poetry run python $(filter-out $@,$(MAKECMDGOALS))

%:
	@:
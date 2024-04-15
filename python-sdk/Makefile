.PHONY: test install

test:
	LANGWATCH_API_KEY="testkey" PYTHONPATH=$$PYTHONPATH:. poetry run pytest -s -vv -m "not integration" $(filter-out $@,$(MAKECMDGOALS))

install:
	@if ! command -v poetry &> /dev/null; then \
		curl -sSL https://install.python-poetry.org | python3 -; \
	fi
	poetry install --all-extras

example:
	poetry run chainlit run -w $(filter-out $@,$(MAKECMDGOALS))

batch-evaluation-example:
	poetry run python $(filter-out $@,$(MAKECMDGOALS))

%:
	@:
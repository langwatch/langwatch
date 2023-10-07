.PHONY: test install

test:
	PYTHONPATH=$$PYTHONPATH:. poetry run pytest -s -vv -m "not integration" $(filter-out $@,$(MAKECMDGOALS))

install:
	@if ! command -v poetry &> /dev/null; then \
		curl -sSL https://install.python-poetry.org | python3 -; \
	fi
	poetry install --all-extras

%:
	@:
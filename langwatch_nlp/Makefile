.PHONY: test test-integration install

test:
	PYTHONPATH=$$PYTHONPATH:langwatch_nlp/. poetry run pytest -s -m "not integration" -vv $(filter-out $@,$(MAKECMDGOALS))

test-integration:
	PYTHONPATH=$$PYTHONPATH:langwatch_nlp/. poetry run pytest -s -m integration $(filter-out $@,$(MAKECMDGOALS))

lock:
	poetry lock --no-update

install: lock
	poetry install

start:
	@echo "Starting the server..."
	@cd langwatch_nlp && \
	poetry run hypercorn main:app --bind :8080 $(filter-out $@,$(MAKECMDGOALS))
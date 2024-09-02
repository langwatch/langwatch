.PHONY: test test-integration install

test:
	PYTHONPATH=$$PYTHONPATH:. poetry run pytest -s -m "not integration" -vv $(filter-out $@,$(MAKECMDGOALS))

test-integration:
	PYTHONPATH=$$PYTHONPATH:. poetry run pytest -s -m integration $(filter-out $@,$(MAKECMDGOALS))

lock:
	poetry lock --no-update

install: lock
	poetry install

generate_proxy_config:
	pip install pyyaml && python langwatch_nlp/generate_proxy_config.py

start:
	@echo "Starting the server..."
	@poetry run watchmedo auto-restart -p 'none' --signal SIGTERM -- \
		hypercorn -- langwatch_nlp.main:app --bind :8080 --reload $(filter-out $@,$(MAKECMDGOALS))
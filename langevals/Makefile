.PHONY: test lock install setup preload start run-docker check-evaluator-versions licenses

# Run tests for all evaluators
test:
	@for dir in evaluators/*; do \
		if [ -d $$dir ]; then \
			echo "Running tests in $$dir"; \
			uv run --directory $$dir pytest -s -vv; \
		fi \
	done

# Lock all dependencies (single unified lock file)
lock:
	uv lock

# Install all packages in development mode
install:
	uv sync --all-extras --all-groups

# Generate workspace config, evaluator dependencies, and TypeScript types
setup:
	uv run python scripts/generate_evaluator_dependencies.py
	uv run python scripts/generate_workspace.py
	uv run python scripts/generate_evaluators_ts.py

# Preload evaluators
preload:
	uv run python langevals/server.py --preload

# Start server
start:
	uv run python langevals/server.py $(filter-out $@,$(MAKECMDGOALS))

# Build and run Docker
run-docker:
	docker build --build-arg EVALUATOR=$(EVALUATOR) -t langevals-$(EVALUATOR) .
	docker run -p 80:80 langevals-$(EVALUATOR)

# Check evaluator versions for changes
check-evaluator-versions:
	@echo "Checking all evaluator versions for changes..."
	@./scripts/check_version_bump.sh langevals_core
	@for dir in evaluators/*; do \
		if [ -d "$$dir" ]; then \
			echo "Checking $$dir"; \
			./scripts/check_version_bump.sh "$$dir"; \
		fi \
	done

# Generate license report
licenses:
	uv run pip-licenses --summary
	uv run pip-licenses --format=json --with-license-file > langevals_licenses.json

%:
	@:

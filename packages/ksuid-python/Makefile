.PHONY: help install test test-coverage lint type-check build clean example

help: ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install development dependencies
	uv sync --dev

test: ## Run tests
	uv run pytest tests/ -v

test-coverage: ## Run tests with coverage
	uv run pytest tests/ --cov=langwatch_ksuid --cov-report=term-missing --cov-report=html

lint: ## Run linting
	uv run ruff check langwatch_ksuid/ tests/
	uv run black --check langwatch_ksuid/ tests/
	uv run isort --check-only langwatch_ksuid/ tests/

lint-fix: ## Fix linting issues
	uv run ruff check --fix langwatch_ksuid/ tests/
	uv run black langwatch_ksuid/ tests/
	uv run isort langwatch_ksuid/ tests/

type-check: ## Run type checking
	uv run mypy langwatch_ksuid/

build: ## Build the package
	uv run python -m build

clean: ## Clean build artifacts
	rm -rf build/
	rm -rf dist/
	rm -rf *.egg-info/
	rm -rf htmlcov/
	rm -rf .coverage

example: ## Run the example script
	uv run python examples/basic_usage.py

all: lint type-check test ## Run all checks (lint, type-check, test)

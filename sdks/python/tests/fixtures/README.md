# Test Fixtures Organization

This directory contains all test fixtures organized by domain/functionality.

## Structure

```
fixtures/
├── __init__.py                     # Central fixture imports
├── README.md                       # This file
├── get_response_factories.py       # Factory for API response objects
├── span_exporter.py               # OpenTelemetry testing utilities
└── prompts/                       # Prompt-specific fixtures
    ├── cli.py                     # CLI-related prompt fixtures
    ├── general.py                 # General utilities (empty_dir, clean_langwatch)
    └── prompt_fixtures.py         # Core prompt fixtures (NEW)
```

## Fixture Categories

### Core Prompt Fixtures (`prompts/prompt_fixtures.py`)
- `mock_config` - Mock API response using factory
- `prompt_data` - PromptData created from mock config
- `prompt` - Prompt instance created from PromptData
- `mock_api_response_for_tracing` - Structured mock for tracing tests

### Factory Fixtures (`get_response_factories.py`)
- `GetPromptResponseFactory` - Factory for creating API response objects

### General Utilities (`prompts/general.py`)
- `empty_dir` - Temporary empty directory
- `clean_langwatch` - Clean LangWatch environment

### CLI Fixtures (`prompts/cli.py`)
- `cli_prompt_setup` - CLI environment setup

### Tracing Fixtures (`span_exporter.py`)
- `span_exporter` - Mock span exporter for OpenTelemetry testing

## Usage

All fixtures are automatically available to test files through pytest's fixture discovery mechanism via `tests/conftest.py`. Simply use the fixture name as a parameter in your test function:

```python
def test_something(prompt, mock_config):
    # prompt and mock_config are automatically injected
    assert prompt.model == mock_config.model
```

## Design Principles

1. **Domain Organization** - Fixtures are grouped by the domain they test (prompts, tracing, etc.)
2. **Single Responsibility** - Each fixture file has a clear, focused purpose
3. **Centralized Access** - All fixtures are available through the main conftest.py
4. **Factory Pattern** - Use factories for complex object creation
5. **Minimal Dependencies** - Fixtures have minimal cross-dependencies

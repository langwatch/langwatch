## Python SDK Testing Antipatterns

| Antipattern | Correct Behavior |
|-------------|------------------|
| Writing E2E tests mixed with unit tests | Keep E2E tests isolated in `tests/e2e/` directory with `@pytest.mark.e2e`. E2E tests verify real API behavior with external services, while examples serve as user demonstrations. |
| Repeating happy paths in integration/unit tests | Do not duplicate E2E/example coverage in integrations or units. Focus integration tests on edge/error cases, and unit tests on pure logic. |
| Failing to follow [TESTING.md](../TESTING.md) hierarchy | Always start with a `.feature` file, drive from E2E tests in `tests/e2e/`, then add integration tests in `tests/` and unit tests as outlined. Examples in `examples/` serve as user demonstrations. |
| Using `pip` or `python` directly for installing, running, or testing | Always use [`uv`](https://github.com/astral-sh/uv) for all dependency installation, package management, and test running. Do not use `pip` commands or `python -m pip`, prefer `uv` equivalents throughout documentation, scripts, and workflows. |

## Testing Structure

The Python SDK follows a hierarchical testing approach:

### `tests/e2e/` - End-to-End Tests
- **Purpose**: Verify real API behavior with external services
- **Location**: `tests/e2e/` directory
- **Markers**: `@pytest.mark.e2e`
- **Run with**: `pytest tests/e2e/` or `pytest -m e2e`
- **Examples**: `test_fetch_policies_e2e.py` - verifies fetch policies work with real API calls

### `examples/` - User Demonstrations
- **Purpose**: Show users how to use the SDK features
- **Location**: `examples/` directory
- **Markers**: None (automatically tested by `test_examples.py`)
- **Run with**: `pytest tests/test_examples.py` or manually as scripts
- **Examples**: `generic_bot.py`, `langchain_bot.py`, etc.

### `tests/` - Integration & Unit Tests
- **Purpose**: Test components and error cases
- **Location**: `tests/` directory
- **Markers**: `@pytest.mark.integration`, `@pytest.mark.unit` (default)
- **Run with**: `pytest tests/` or `pytest -m "not e2e"`

### Running Tests Selectively
```bash
# Run all tests except E2E (fast CI)
pytest tests/ -m "not e2e"

# Run only E2E tests (requires API keys)
pytest tests/e2e/

# Run examples as demonstrations
pytest tests/test_examples.py
```



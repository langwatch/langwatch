## Python SDK Testing Antipatterns

| Antipattern | Correct Behavior |
|-------------|------------------|
| Writing E2E tests in `tests/` | Do not write E2E tests in the test suite. E2E coverage is provided by running `examples/` as working usage demonstrations. |
| Repeating happy paths in integration/unit tests | Do not duplicate E2E/example coverage in integrations or units. Focus integration tests on edge/error cases, and unit tests on pure logic. |
| Failing to follow [TESTING.md](../TESTING.md) hierarchy | Always start with a `.feature` file, drive from E2E/example, then add integration and unit tests as outlined. |
| Using `pip` or `python` directly for installing, running, or testing | Always use [`uv`](https://github.com/astral-sh/uv) for all dependency installation, package management, and test running. Do not use `pip` commands or `python -m pip`, prefer `uv` equivalents throughout documentation, scripts, and workflows. |



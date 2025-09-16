# tests/fixtures/prompts/general.py
"""
General fixtures for prompt testing.

These fixtures provide common utilities for testing prompt functionality,
including LangWatch client setup and cleanup.
"""
import pytest
from pathlib import Path
import tempfile

import langwatch


@pytest.fixture
def empty_dir():
    """
    Fixture that provides an empty temporary directory.

    Useful for testing API fallback behavior when no local files exist.
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


@pytest.fixture
def clean_langwatch():
    """
    Fixture that ensures langwatch is properly initialized and cleaned up for each test.

    This fixture:
    - Resets the global LangWatch instance before each test
    - Clears any cached prompts service
    - Sets up a test configuration
    - Cleans up after the test completes
    """
    # Reset the global instance first
    from langwatch.state import set_instance

    set_instance(None)

    # Clear any cached prompts before test
    if "prompts" in langwatch.__dict__:
        del langwatch.__dict__["prompts"]

    # Setup langwatch client with test configuration
    langwatch.setup(api_key="test-api-key", endpoint_url="http://localhost:3000")

    yield

    # Clean up after test
    if "prompts" in langwatch.__dict__:
        del langwatch.__dict__["prompts"]

    # Reset the global instance
    set_instance(None)

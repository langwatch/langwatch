import os

import pytest


@pytest.fixture(autouse=True)
def openai_key_in_environment(monkeypatch):
    """Requests in these tests name OpenAI models without a key, as the endpoints allow
    when langevals has one of its own."""
    if not os.environ.get("OPENAI_API_KEY"):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-placeholder")

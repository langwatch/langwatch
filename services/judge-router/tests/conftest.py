import os
import socket
import sys
import urllib.request

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from judge_router import load  # noqa: E402
from judge_router.config import DEFAULT_METRICS_PATH  # noqa: E402


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Tests never reach a provider: any real socket or urlopen fails the test."""
    def refuse(*a, **k):
        raise AssertionError("network call attempted in a test")
    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)
    for k in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "TYPESAFE_API_KEY"):
        monkeypatch.delenv(k, raising=False)


@pytest.fixture(scope="session")
def table():
    """The routing table alone (routes.yaml), as the public repo ships it."""
    return load(use_metrics=False)


@pytest.fixture(scope="session")
def metrics_table():
    """routes.yaml with the private metrics overlay; tests that read numbers skip without it."""
    if not os.path.exists(DEFAULT_METRICS_PATH):
        pytest.skip("metrics overlay routes.metrics.yaml not present")
    return load()

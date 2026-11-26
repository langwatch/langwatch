"""Puts the repository root on the import path and registers the agent_test mark."""

import sys
from pathlib import Path

# The repository root, two folders up from tests/owasp/. Change the 2 if the pack lives deeper.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


def pytest_configure(config):
    config.addinivalue_line("markers", "agent_test: OWASP red team attacks against a real model")

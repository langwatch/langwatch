# Isolation shared by every connected-agent test.
#
# Two pieces of process-wide state decide whether a client connects at all,
# and both are set by other tests or by the runner itself:
#
#   * `CI` disables the connection by design, so a suite that runs on a build
#     machine would time out on every socket test.
#   * `langwatch.state` keeps one client singleton, and `get_api_key()` and
#     `get_endpoint()` read it in front of the environment. A test that calls
#     `langwatch.setup()` earlier in the session makes these tests resolve a
#     key and an endpoint they never set.

import pytest

from langwatch.state import set_instance


@pytest.fixture(autouse=True)
def connected_agent_isolation(monkeypatch):
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("LANGWATCH_AGENT_CONNECT", raising=False)
    set_instance(None)  # type: ignore[arg-type]
    yield
    set_instance(None)  # type: ignore[arg-type]

# Isolation shared by every connected-agent test.
#
# Three pieces of process-wide state decide whether a client connects at all,
# and every one of them is set by other tests or by the runner itself:
#
#   * `CI` disables the connection by design, so a suite that runs on a build
#     machine would time out on every socket test.
#   * `langwatch.state` keeps one client singleton, and `get_api_key()` and
#     `get_endpoint()` read it in front of the environment. A test that calls
#     `langwatch.setup()` earlier in the session makes these tests resolve a
#     key and an endpoint they never set.
#   * `langwatch.agent.client` keeps the default agent client. A test that
#     starts it leaves a connection thread behind, so the next test inherits
#     an agent registry and a socket it did not open.

import pytest

from langwatch.agent import client as client_module
from langwatch.state import set_instance


@pytest.fixture(autouse=True)
def connected_agent_isolation(monkeypatch):
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("LANGWATCH_AGENT_CONNECT", raising=False)
    set_instance(None)  # type: ignore[arg-type]
    client_module._reset_default_client_for_tests()
    yield
    client_module._reset_default_client_for_tests()
    set_instance(None)  # type: ignore[arg-type]

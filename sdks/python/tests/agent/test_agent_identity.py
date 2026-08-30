# Environment resolution, sanitizing and the instance identity of a
# connected agent process.
#
# See specs/python-sdk/agent-decorator.feature

import os

import pytest

from langwatch.agent import identity
from langwatch.agent.client import connection_headers, socket_url


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in (
        "LANGWATCH_AGENT_ENVIRONMENT",
        "APP_ENV",
        "ENVIRONMENT",
        "NODE_ENV",
        "CI",
        "LANGWATCH_AGENT_CONNECT",
        "LANGWATCH_AGENT_INSTANCE_LABEL",
    ):
        monkeypatch.delenv(name, raising=False)


# @scenario "The environment is resolved in a fixed order"
def test_environment_resolution_order(monkeypatch):
    assert identity.resolve_environment() == "development"

    monkeypatch.setenv("NODE_ENV", "node")
    assert identity.resolve_environment() == "node"

    monkeypatch.setenv("ENVIRONMENT", "env")
    assert identity.resolve_environment() == "env"

    monkeypatch.setenv("APP_ENV", "app")
    assert identity.resolve_environment() == "app"

    monkeypatch.setenv("LANGWATCH_AGENT_ENVIRONMENT", "agent")
    assert identity.resolve_environment() == "agent"

    assert identity.resolve_environment("explicit") == "explicit"
    assert identity.resolve_environment("   ") == "agent"


# @scenario "The environment is sanitized"
def test_environment_is_sanitized():
    assert identity.sanitize_environment("  Staging EU / Blue!  ") == "staging-eu-blue"
    # The platform grammar drops the dot and caps the name at 32 characters,
    # so the SDK does the same. Two names that differ only past that point
    # would otherwise register as one agent.
    assert identity.sanitize_environment("prod.v2_a") == "prod-v2_a"
    assert identity.sanitize_environment("---") == "development"
    assert identity.sanitize_environment("x" * 100) == "x" * 32
    assert identity.sanitize_environment(None) == "development"


def test_enabled_resolution(monkeypatch):
    assert identity.resolve_enabled() is True
    assert identity.resolve_enabled(False) is False

    monkeypatch.setenv("CI", "true")
    assert identity.resolve_enabled() is False
    assert identity.resolve_enabled(True) is True

    monkeypatch.setenv("CI", "0")
    assert identity.resolve_enabled() is True

    monkeypatch.setenv("CI", "1")
    monkeypatch.setenv("LANGWATCH_AGENT_CONNECT", "1")
    assert identity.resolve_enabled() is True

    monkeypatch.setenv("LANGWATCH_AGENT_CONNECT", "false")
    assert identity.resolve_enabled(True) is False
    monkeypatch.setenv("LANGWATCH_AGENT_CONNECT", "0")
    assert identity.resolve_enabled(True) is False


# @scenario "The instance identity carries hostname, username, pid and label"
def test_instance_identity_fields(monkeypatch):
    monkeypatch.setattr(
        identity.socket, "gethostname", lambda: "Rogerios-MacBook.local"
    )
    monkeypatch.setattr(identity.getpass, "getuser", lambda: "rogerio")

    instance = identity.InstanceIdentity(label="blue")
    frame = instance.to_frame(in_flight_call_ids=["call-1"])

    assert frame["hostname"] == "rogerios-macbook"
    assert frame["username"] == "rogerio"
    assert frame["pid"] == os.getpid()
    assert frame["label"] == "blue"
    assert frame["inFlightCallIds"] == ["call-1"]
    assert frame["id"] == instance.id and len(frame["id"]) == 32
    assert frame["startedAt"].endswith("+00:00")


def test_identity_lookups_that_fail_leave_the_field_empty(monkeypatch):
    def broken():
        raise OSError("no passwd entry")

    monkeypatch.setattr(identity.socket, "gethostname", broken)
    monkeypatch.setattr(identity.getpass, "getuser", broken)

    frame = identity.InstanceIdentity().to_frame(in_flight_call_ids=[])

    assert frame["hostname"] == ""
    assert frame["username"] == ""
    assert "label" not in frame


def test_host_label_sanitizing():
    assert identity.host_label("Rogerios-MacBook.local") == "rogerios-macbook"
    assert identity.host_label("ip-10-0-0-1.ec2.internal") == "ip-10-0-0-1-ec2-internal"
    assert identity.host_label("box.lan") == "box"
    assert identity.host_label("--weird__name--") == "weird-name"
    assert identity.host_label("a" * 40) == "a" * 24
    assert identity.host_label("") == ""


# @scenario "The instance label comes from the argument or the environment"
def test_instance_label_resolution(monkeypatch):
    assert identity.resolve_instance_label() is None

    monkeypatch.setenv("LANGWATCH_AGENT_INSTANCE_LABEL", "  pod  a  ")
    assert identity.resolve_instance_label() == "pod a"
    assert identity.resolve_instance_label("explicit") == "explicit"
    assert identity.resolve_instance_label("x" * 100) == "x" * 64


# @scenario "The socket URL is derived from the configured endpoint"
def test_socket_url_from_endpoint():
    assert (
        socket_url("https://app.langwatch.ai")
        == "wss://app.langwatch.ai/api/v1/agents/connect"
    )
    assert (
        socket_url("https://app.langwatch.ai/")
        == "wss://app.langwatch.ai/api/v1/agents/connect"
    )
    assert (
        socket_url("http://localhost:5560") == "ws://localhost:5560/api/v1/agents/connect"
    )
    assert (
        socket_url("https://lw.example.com/base/")
        == "wss://lw.example.com/base/api/v1/agents/connect"
    )


# @scenario "The connection carries the API key and the SDK version"
def test_connection_headers():
    from langwatch.__version__ import __version__

    headers = connection_headers(api_key="sk-lw-secret", project_id=None)
    assert headers == {
        "Authorization": "Bearer sk-lw-secret",
        "User-Agent": f"langwatch-python/{__version__}",
    }

    with_project = connection_headers(api_key="sk-lw-secret", project_id="proj_1")
    assert with_project["X-Project-Id"] == "proj_1"
    assert "sk-lw-secret" not in socket_url("https://app.langwatch.ai")

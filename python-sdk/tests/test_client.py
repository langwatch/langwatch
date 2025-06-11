from unittest.mock import patch
from langwatch.client import Client
from typing import Optional
import pytest


def make_client(api_key: Optional[str] = None, disable_sending: bool = False) -> Client:
    return Client(api_key=api_key, disable_sending=disable_sending)


def test_api_key_setter_same_key():
    client = make_client(api_key="abc123")
    with (
        patch.object(client, "_Client__shutdown_tracer_provider") as shutdown,
        patch.object(client, "_Client__setup_tracer_provider") as setup_tracer,
        patch.object(client, "_setup_rest_api_client") as setup_rest,
    ):
        client.api_key = "abc123"
        shutdown.assert_not_called()
        setup_tracer.assert_not_called()
        setup_rest.assert_not_called()


def test_api_key_setter_new_key_reinitializes():
    client = make_client(api_key="abc123")
    with (
        patch.object(client, "_Client__shutdown_tracer_provider") as shutdown,
        patch.object(client, "_Client__setup_tracer_provider") as setup_tracer,
        patch.object(client, "_setup_rest_api_client") as setup_rest,
    ):
        client.api_key = "def456"
        shutdown.assert_called_once()
        setup_tracer.assert_called_once()
        setup_rest.assert_called_once()
        assert client.api_key == "def456"


def test_api_key_setter_disable_sending():
    client = make_client(api_key="abc123", disable_sending=True)
    with (
        patch.object(client, "_Client__shutdown_tracer_provider") as shutdown,
        patch.object(client, "_Client__setup_tracer_provider") as setup_tracer,
        patch.object(client, "_setup_rest_api_client") as setup_rest,
    ):
        client.api_key = "def456"
        shutdown.assert_called_once()
        setup_tracer.assert_not_called()  # Should not setup tracer provider
        setup_rest.assert_called_once()
        assert client.api_key == "def456"


def test_api_key_setter_empty_key():
    client = make_client(api_key="abc123")
    with (
        patch.object(client, "_Client__shutdown_tracer_provider") as shutdown,
        patch.object(client, "_Client__setup_tracer_provider") as setup_tracer,
        patch.object(client, "_setup_rest_api_client") as setup_rest,
    ):
        client.api_key = ""
        shutdown.assert_called_once()
        setup_tracer.assert_not_called()
        setup_rest.assert_not_called()
        assert client.api_key == ""


def test_api_key_change_always_calls_shutdown():
    client = make_client(api_key="first-key")
    with (
        patch.object(client, "_Client__shutdown_tracer_provider") as shutdown,
        patch.object(client, "_Client__setup_tracer_provider") as setup_tracer,
        patch.object(client, "_setup_rest_api_client") as setup_rest,
    ):
        client.api_key = "second-key"
        shutdown.assert_called_once()
        setup_tracer.assert_called_once()
        setup_rest.assert_called_once()
        assert client.api_key == "second-key"


def test_api_key_change_to_empty_always_calls_shutdown():
    client = make_client(api_key="first-key")
    with (
        patch.object(client, "_Client__shutdown_tracer_provider") as shutdown,
        patch.object(client, "_Client__setup_tracer_provider") as setup_tracer,
        patch.object(client, "_setup_rest_api_client") as setup_rest,
    ):
        client.api_key = ""
        shutdown.assert_called_once()
        setup_tracer.assert_not_called()
        setup_rest.assert_not_called()
        assert client.api_key == ""


def test_no_data_leak_between_api_keys(monkeypatch: pytest.MonkeyPatch):
    # We'll check that the rest_api_client is re-initialized with the new key
    client = make_client(api_key="first-key")
    from langwatch.generated.langwatch_rest_api_client.client import Client as ApiClient

    created_clients: list[ApiClient] = []

    class DummyApiClient(ApiClient):
        def __init__(
            self,
            base_url: str,
            headers: dict[str, str],
            raise_on_unexpected_status: bool,
        ):
            super().__init__(
                base_url=base_url,
                headers=headers,
                raise_on_unexpected_status=raise_on_unexpected_status,
            )
            created_clients.append(self)

    monkeypatch.setattr("langwatch.client.LangWatchApiClient", DummyApiClient)

    # Set a new API key
    client.api_key = "second-key"
    # The last created client should have the new key, not the old one
    assert created_clients[-1]._headers["X-Auth-Token"] == "second-key"  # type: ignore[protected-access]
    assert "first-key" not in created_clients[-1]._headers.values()  # type: ignore[protected-access]

    # Set another new API key
    client.api_key = "third-key"
    assert created_clients[-1]._headers["X-Auth-Token"] == "third-key"  # type: ignore[protected-access]
    assert "second-key" not in created_clients[-1]._headers.values()  # type: ignore[protected-access]


def test_tracer_provider_reinitialized_on_api_key_change():
    client = make_client(api_key="first-key")
    with (
        patch.object(client, "_Client__shutdown_tracer_provider") as shutdown,
        patch.object(client, "_Client__setup_tracer_provider") as setup_tracer,
    ):
        client.api_key = "second-key"
        shutdown.assert_called_once()
        setup_tracer.assert_called_once()

    # Changing to the same key should not reinitialize
    with (
        patch.object(client, "_Client__shutdown_tracer_provider") as shutdown2,
        patch.object(client, "_Client__setup_tracer_provider") as setup_tracer2,
    ):
        client.api_key = "second-key"
        shutdown2.assert_not_called()
        setup_tracer2.assert_not_called()

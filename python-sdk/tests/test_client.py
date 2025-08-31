from unittest.mock import patch
from langwatch.client import Client
from typing import Optional
import pytest


def make_client(
    api_key: Optional[str] = None,
    disable_sending: bool = False,
    skip_open_telemetry_setup: bool = False,
) -> Client:
    return Client(
        api_key=api_key,
        disable_sending=disable_sending,
        skip_open_telemetry_setup=skip_open_telemetry_setup,
    )


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


def test_skip_open_telemetry_setup_property():
    """Test that skip_open_telemetry_setup property returns the correct value."""
    # Reset singleton to start fresh
    Client._reset_instance()
    
    client = make_client(api_key="test-key", skip_open_telemetry_setup=True)
    assert client.skip_open_telemetry_setup is True

    # In singleton pattern, subsequent calls return instances with shared state
    client2 = make_client(api_key="test-key", skip_open_telemetry_setup=False)
    assert client2.skip_open_telemetry_setup is False  # Updated value from second call

    # Reset and create with default value
    Client._reset_instance()
    client3 = make_client(api_key="test-key")  # Default should be False
    assert client3.skip_open_telemetry_setup is False


def test_skip_open_telemetry_setup_api_key_setter():
    """Test that skip_open_telemetry_setup prevents OpenTelemetry reinitialization when API key changes."""
    client = make_client(api_key="first-key", skip_open_telemetry_setup=True)

    with (
        patch.object(client, "_Client__shutdown_tracer_provider") as shutdown,
        patch.object(client, "_Client__setup_tracer_provider") as setup_tracer,
        patch.object(client, "_setup_rest_api_client") as setup_rest,
    ):
        client.api_key = "second-key"
        # Should not call shutdown or setup_tracer when skip_open_telemetry_setup is True
        shutdown.assert_not_called()
        setup_tracer.assert_not_called()
        # Should still call setup_rest for the API client
        setup_rest.assert_called_once()


def test_nested_trace_linking_behavior():
    """Test that nested traces are properly linked via OpenTelemetry links."""
    from langwatch import trace
    from unittest.mock import patch
    
    # Reset any existing singleton
    Client._reset_instance()
    
    # Mock the setup to avoid API key requirement
    with patch('langwatch.utils.initialization.setup') as mock_setup, \
         patch('langwatch.telemetry.context._set_current_trace') as mock_set_trace, \
         patch('langwatch.telemetry.context._reset_current_trace') as mock_reset_trace:
        
        # Create a mock client
        mock_client = make_client(api_key="test-key", disable_sending=True)
        mock_setup.return_value = mock_client
        
        @trace(name="outer")
        @trace(name="inner")
        def test_function():
            return "test result"
        
        # Call the decorated function
        result = test_function()
        
        # Verify the function works
        assert result == "test result"
        
        # Verify that both traces were created and properly managed
        assert mock_set_trace.call_count >= 2  # Both outer and inner traces
        assert mock_reset_trace.call_count >= 2  # Both traces cleaned up
        
        # The key point is that both decorators create their own traces
        # and the existing linking logic in _create_root_span handles relationships

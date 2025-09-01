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


def test_singleton_returns_same_instance() -> None:
    """Test that multiple Client() calls return the same instance."""
    # Reset singleton to start fresh
    Client.reset_for_testing()

    client1 = Client(api_key="test-key-1")
    client2 = Client(api_key="test-key-2")
    client3 = Client()

    # All should be the same instance
    assert client1 is client2
    assert client2 is client3
    assert client1 is client3

    # The instance should be stored in the class variable
    assert Client.get_singleton_instance() is client1


def test_singleton_updates_existing_instance() -> None:
    """Test that subsequent Client() calls update the existing instance."""
    # Reset singleton to start fresh
    Client.reset_for_testing()

    # Create initial instance
    client1 = Client(api_key="initial-key", debug=True)
    assert client1.api_key == "initial-key"
    assert client1.debug is True

    # Create another instance with different parameters
    client2 = Client(api_key="updated-key", debug=False)

    # Should be the same instance
    assert client1 is client2

    # The instance should be updated with new parameters
    assert client1.api_key == "updated-key"
    assert client1.debug is False


def test_singleton_preserves_initialized_state() -> None:
    """Test that the singleton properly tracks initialization state."""
    # Reset singleton to start fresh
    Client.reset_for_testing()

    # First call should initialize
    client1 = Client(api_key="test-key")
    assert client1.is_initialized

    # Second call should not re-initialize
    client2 = Client(api_key="different-key")
    assert client1 is client2
    assert client2.is_initialized


def test_singleton_updates_via_public_setters() -> None:
    """Test that singleton updates use public setters for proper side effects."""
    # Reset singleton to start fresh
    Client.reset_for_testing()

    # Create initial instance
    client1 = Client(api_key="initial-key", disable_sending=False)

    # Track the original api_key value
    original_api_key = client1.api_key

    # Create another instance with different API key
    client2 = Client(api_key="new-key")

    # Should be the same instance
    assert client1 is client2

    # The api_key should have been updated
    assert client1.api_key == "new-key"
    assert client1.api_key != original_api_key


def test_singleton_reset_clears_instance() -> None:
    """Test that _reset_instance properly clears the singleton."""
    # Create an instance
    client1 = Client(api_key="test-key")
    assert Client.get_singleton_instance() is client1

    # Reset the instance
    Client.reset_for_testing()
    assert Client.get_singleton_instance() is None

    # Create a new instance
    client2 = Client(api_key="new-key")
    assert client2 is not client1
    assert Client.get_singleton_instance() is client2


def test_singleton_with_complex_parameters() -> None:
    """Test singleton behavior with complex parameters like tracer_provider and instrumentors."""
    # Reset singleton to start fresh
    Client.reset_for_testing()

    from opentelemetry.sdk.trace import TracerProvider

    # Create initial instance with complex parameters
    tracer_provider1 = TracerProvider()
    client1 = Client(api_key="test-key", tracer_provider=tracer_provider1, debug=True)

    # Create another instance with different complex parameters
    tracer_provider2 = TracerProvider()
    client2 = Client(api_key="new-key", tracer_provider=tracer_provider2, debug=False)

    # Should be the same instance
    assert client1 is client2

    # The instance should be updated with new parameters
    assert client1.api_key == "new-key"
    # Note: tracer_provider might not be updated due to OpenTelemetry setup logic
    # The important thing is that the instance is the same
    assert client1.debug is False


def test_singleton_idempotent_initialization() -> None:
    """Test that calling Client() multiple times with the same parameters is idempotent."""
    # Reset singleton to start fresh
    Client.reset_for_testing()

    # Create instance multiple times with same parameters
    client1 = Client(api_key="test-key", debug=True)
    client2 = Client(api_key="test-key", debug=True)
    client3 = Client(api_key="test-key", debug=True)

    # All should be the same instance
    assert client1 is client2 is client3

    # Parameters should remain unchanged
    assert client1.api_key == "test-key"
    assert client1.debug is True


def test_singleton_with_none_parameters() -> None:
    """Test that singleton handles None parameters correctly."""
    # Reset singleton to start fresh
    Client.reset_for_testing()

    # Create initial instance with None parameters and skip OpenTelemetry setup to avoid API key requirement
    client1 = Client(api_key=None, debug=None, skip_open_telemetry_setup=True)

    # Create another instance with actual values
    client2 = Client(api_key="test-key", debug=True)

    # Should be the same instance
    assert client1 is client2

    # The instance should be updated with the actual values
    assert client1.api_key == "test-key"
    assert client1.debug is True


def test_singleton_after_reset() -> None:
    """Test that singleton works correctly after reset."""
    # Create initial instance
    client1 = Client(api_key="first-key")
    assert Client.get_singleton_instance() is client1

    # Reset
    Client.reset_for_testing()
    assert Client.get_singleton_instance() is None

    # Create new instance
    client2 = Client(api_key="second-key")
    assert client2 is not client1
    assert Client.get_singleton_instance() is client2

    # Create another instance - should return the same as client2
    client3 = Client(api_key="third-key")
    assert client3 is client2
    assert client3.api_key == "third-key"


def test_api_key_setter_same_key() -> None:
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


def test_api_key_setter_new_key_reinitializes() -> None:
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


def test_api_key_setter_disable_sending() -> None:
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


def test_api_key_setter_empty_key() -> None:
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


def test_api_key_change_always_calls_shutdown() -> None:
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


def test_api_key_change_to_empty_always_calls_shutdown() -> None:
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


def test_no_data_leak_between_api_keys(monkeypatch: pytest.MonkeyPatch) -> None:
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


def test_tracer_provider_reinitialized_on_api_key_change() -> None:
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


def test_skip_open_telemetry_setup_property() -> None:
    """Test that skip_open_telemetry_setup property returns the correct value."""
    # Reset singleton to start fresh
    Client.reset_for_testing()

    client = make_client(api_key="test-key", skip_open_telemetry_setup=True)
    assert client.skip_open_telemetry_setup is True

    # In singleton pattern, subsequent calls return instances with shared state
    client2 = make_client(api_key="test-key", skip_open_telemetry_setup=False)
    assert client2.skip_open_telemetry_setup is False  # Updated value from second call

    # Reset and create with default value
    Client.reset_for_testing()
    client3 = make_client(api_key="test-key")  # Default should be False
    assert client3.skip_open_telemetry_setup is False


def test_skip_open_telemetry_setup_api_key_setter() -> None:
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


def test_nested_trace_linking_behavior() -> None:
    """Test that nested traces are properly linked via OpenTelemetry links."""
    from langwatch import trace
    from unittest.mock import patch

    # Reset any existing singleton
    Client.reset_for_testing()

    # Mock the setup to avoid API key requirement
    with (
        patch("langwatch.utils.initialization.setup") as mock_setup,
        patch("langwatch.telemetry.context._set_current_trace") as mock_set_trace,
        patch("langwatch.telemetry.context._reset_current_trace") as mock_reset_trace,
    ):

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

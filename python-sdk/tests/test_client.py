from unittest.mock import patch
from langwatch.client import Client
from typing import Optional
import pytest


def make_client(
    api_key: Optional[str] = None,
    disable_sending: bool = False,
    skip_open_telemetry_setup: bool = False,
    debug: Optional[bool] = None,
) -> Client:
    return Client(
        api_key=api_key,
        disable_sending=disable_sending,
        skip_open_telemetry_setup=skip_open_telemetry_setup,
        debug=debug,
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
    client = make_client(api_key="test-key", skip_open_telemetry_setup=True)
    assert client.skip_open_telemetry_setup is True

    client2 = make_client(api_key="test-key", skip_open_telemetry_setup=False)
    assert client2.skip_open_telemetry_setup is False

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


# Singleton Pattern Tests
def test_singleton_first_instance():
    """Test that the first instance becomes the singleton."""
    # Reset any existing singleton
    Client._reset_instance()

    client1 = make_client(api_key="first-key", debug=True)

    # Check that the singleton instance is set
    assert Client._instance is not None
    assert Client._instance is client1
    assert Client._get_instance() is client1


def test_singleton_subsequent_instances():
    """Test that subsequent instances share the same configuration as the first."""
    # Reset any existing singleton
    Client._reset_instance()

    # Create first instance
    client1 = make_client(api_key="first-key", debug=True)

    # Create second instance with different parameters
    client2 = make_client(api_key="second-key", debug=False)

    # Both should have the same configuration as the first instance
    assert client2.api_key == "first-key"
    assert client2.debug is True

    # They should be different objects but share the same singleton instance
    assert client1 is not client2  # Different objects
    assert client2 is Client._get_instance()  # But client2 is the singleton


def test_singleton_attribute_sharing():
    """Test that all instances share the same attributes."""
    # Reset any existing singleton
    Client._reset_instance()

    # Create first instance
    client1 = make_client(api_key="test-key", debug=True)

    # Create multiple subsequent instances
    client2 = make_client(api_key="different-key", debug=False)
    client3 = make_client(api_key="another-key", debug=False)

    # All should have the same configuration
    assert client1.api_key == "test-key"
    assert client2.api_key == "test-key"
    assert client3.api_key == "test-key"

    assert client1.debug is True
    assert client2.debug is True
    assert client3.debug is True

    # All should point to the same singleton instance
    assert client1 is Client._get_instance()
    assert client2 is Client._get_instance()
    assert client3 is Client._get_instance()


def test_singleton_get_instance_method():
    """Test the _get_instance class method."""
    # Reset any existing singleton
    Client._reset_instance()

    # Initially, no instance should exist
    assert Client._get_instance() is None

    # Create an instance
    client1 = make_client(api_key="test-key")

    # _get_instance should return the singleton
    instance = Client._get_instance()
    assert instance is not None
    assert instance is client1
    assert instance.api_key == "test-key"


def test_singleton_create_instance_method():
    """Test the _create_instance class method."""
    # Reset any existing singleton
    Client._reset_instance()

    # Create instance using _create_instance
    client1 = Client._create_instance(api_key="test-key", debug=True)

    # Check that it's the singleton
    assert client1 is Client._get_instance()
    assert client1.api_key == "test-key"
    assert client1.debug is True

    # Create another instance using _create_instance with different params
    client2 = Client._create_instance(api_key="different-key", debug=False)

    # Should return the same instance with original configuration
    assert client2 is client1
    assert client2.api_key == "test-key"  # Original configuration
    assert client2.debug is True  # Original configuration


def test_singleton_reset_instance_method():
    """Test the _reset_instance class method."""
    # Reset any existing singleton
    Client._reset_instance()

    # Create an instance
    client1 = make_client(api_key="test-key")
    assert Client._get_instance() is client1

    # Reset the instance
    Client._reset_instance()
    assert Client._get_instance() is None

    # Create a new instance after reset
    client2 = make_client(api_key="new-key", debug=True)
    assert Client._get_instance() is client2
    assert client2.api_key == "new-key"
    assert client2.debug is True


def test_singleton_reset_instance_with_tracer_provider():
    """Test that _reset_instance properly shuts down tracer provider."""
    # Reset any existing singleton
    Client._reset_instance()

    # Create an instance with a tracer provider
    client1 = make_client(api_key="test-key")

    # Mock the shutdown method
    with patch.object(client1, "_Client__shutdown_tracer_provider") as shutdown_mock:
        Client._reset_instance()
        shutdown_mock.assert_called_once()


def test_singleton_multiple_resets():
    """Test multiple reset and create cycles."""
    # Reset any existing singleton
    Client._reset_instance()

    # First cycle
    client1 = make_client(api_key="first-key")
    assert client1.api_key == "first-key"

    Client._reset_instance()
    assert Client._get_instance() is None

    # Second cycle
    client2 = make_client(api_key="second-key", debug=True)
    assert client2.api_key == "second-key"
    assert client2.debug is True

    Client._reset_instance()
    assert Client._get_instance() is None

    # Third cycle
    client3 = make_client(api_key="third-key", debug=False)
    assert client3.api_key == "third-key"
    assert client3.debug is False


def test_singleton_environment_variables():
    """Test that singleton works correctly with environment variables."""
    # Reset any existing singleton
    Client._reset_instance()

    # Set environment variables
    import os

    os.environ["LANGWATCH_API_KEY"] = "env-key"
    os.environ["LANGWATCH_DEBUG"] = "true"

    # Create first instance (should use env vars)
    client1 = make_client()  # No explicit api_key or debug

    # Create second instance with explicit values
    client2 = make_client(api_key="explicit-key", debug=False)

    # Both should have the same configuration as the first (env vars)
    assert client1.api_key == "env-key"
    assert client1.debug is True
    assert client2.api_key == "env-key"
    assert client2.debug is True

    # Clean up environment
    if "LANGWATCH_API_KEY" in os.environ:
        del os.environ["LANGWATCH_API_KEY"]
    if "LANGWATCH_DEBUG" in os.environ:
        del os.environ["LANGWATCH_DEBUG"]


def test_singleton_debug_logging():
    """Test that debug logging works correctly in singleton pattern."""
    # Reset any existing singleton
    Client._reset_instance()

    # Create first instance with debug enabled
    client1 = make_client(api_key="test-key", debug=True)

    # Create second instance with debug disabled (should still be enabled due to singleton)
    client2 = make_client(api_key="different-key", debug=False)

    # Both should have debug enabled (from first instance)
    assert client1.debug is True
    assert client2.debug is True


def test_singleton_base_attributes():
    """Test that base attributes are shared across singleton instances."""
    # Reset any existing singleton
    Client._reset_instance()

    # Create first instance with custom base attributes
    base_attrs = {"custom_key": "custom_value"}
    client1 = make_client(api_key="test-key")
    client1.base_attributes.update(base_attrs)

    # Create second instance
    client2 = make_client(api_key="different-key")

    # Both should have the same base attributes
    assert client1.base_attributes["custom_key"] == "custom_value"
    assert client2.base_attributes["custom_key"] == "custom_value"

    # Modifying base attributes on one should affect the other
    client2.base_attributes["new_key"] = "new_value"
    assert client1.base_attributes["new_key"] == "new_value"


def test_singleton_instrumentors():
    """Test that instrumentors are shared across singleton instances."""
    # Reset any existing singleton
    Client._reset_instance()

    # Create first instance
    client1 = make_client(api_key="test-key")
    # Note: We can't directly assign to instrumentors as it's a Sequence
    # This test demonstrates that the singleton pattern works for the instrumentors attribute
    original_instrumentors = client1.instrumentors

    # Create second instance
    client2 = make_client(api_key="different-key")

    # Both should have the same instrumentors reference
    assert client1.instrumentors is client2.instrumentors
    assert client1.instrumentors == original_instrumentors

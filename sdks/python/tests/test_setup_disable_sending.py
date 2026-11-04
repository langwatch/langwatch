"""Regression test for #776: `langwatch.setup()` must forward `disable_sending` to `Client`."""

import opentelemetry.trace
import pytest
from opentelemetry.util._once import Once

import langwatch
from langwatch.client import Client
from langwatch.state import get_instance


def _reset_global_tracer_provider():
    # OTel lets the global provider be set once per process; the client uses
    # the same reset when an API key change replaces its provider.
    opentelemetry.trace._TRACER_PROVIDER = None  # type: ignore[attr-defined]
    opentelemetry.trace._TRACER_PROVIDER_SET_ONCE = Once()  # type: ignore[attr-defined]


@pytest.fixture(autouse=True)
def reset_client():
    Client.reset_for_testing()
    yield
    Client.reset_for_testing()


# @scenario "setup() with disable_sending=True disables sending on the client"
def test_setup_forwards_disable_sending_true():
    client = langwatch.setup(
        api_key="test-key-776",
        skip_open_telemetry_setup=True,
        disable_sending=True,
    )

    assert client.disable_sending is True
    assert get_instance() is client


# @scenario "setup() without disable_sending keeps sending enabled"
def test_setup_defaults_to_sending_enabled():
    client = langwatch.setup(api_key="test-key-776", skip_open_telemetry_setup=True)

    assert client.disable_sending is False


# @scenario "Re-enabling sending through setup() resumes the provider it created"
def test_setup_re_enabling_sending_resumes_the_provider():
    _reset_global_tracer_provider()
    try:
        langwatch.setup(
            api_key="test-key-776",
            endpoint_url="http://127.0.0.1:9",
            disable_sending=True,
        )
        provider = Client._tracer_provider
        assert provider is not None
        tracer_from_before = provider.get_tracer("test-776")
        assert not tracer_from_before.start_span("while-disabled").is_recording()
        assert id(provider) not in Client._exporter_attached_providers

        client = langwatch.setup(api_key="test-key-776", disable_sending=False)

        assert client.disable_sending is False
        assert Client._tracer_provider is provider
        assert id(provider) in Client._exporter_attached_providers
        # A tracer handed out while sending was disabled samples again too.
        assert tracer_from_before.start_span("after-re-enable").is_recording()
        assert provider.get_tracer("test-776-new").start_span("new").is_recording()
    finally:
        Client.reset_for_testing()
        _reset_global_tracer_provider()


# @scenario "setup() inside a disable_sending trace keeps sending disabled after the trace"
def test_setup_inside_a_disabled_trace_survives_the_trace_exit():
    client = langwatch.setup(api_key="test-key-776", skip_open_telemetry_setup=True)

    with langwatch.trace(name="disabled-trace", disable_sending=True):
        langwatch.setup(disable_sending=True)
        assert client.disable_sending is True

    assert client.disable_sending is True


# @scenario "setup() inside a disable_sending trace can re-enable sending after the trace"
def test_setup_re_enabling_inside_a_disabled_trace_applies_on_exit():
    client = langwatch.setup(
        api_key="test-key-776", skip_open_telemetry_setup=True, disable_sending=True
    )

    with langwatch.trace(name="disabled-trace", disable_sending=True):
        langwatch.setup(disable_sending=False)
        # The trace asked for sending off; it stays off until the trace ends.
        assert client.disable_sending is True

    assert client.disable_sending is False

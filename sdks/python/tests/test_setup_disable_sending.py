"""Regression test for #776: `langwatch.setup()` must forward `disable_sending` to `Client`."""

import pytest

import langwatch
from langwatch.client import Client
from langwatch.state import get_instance


@pytest.fixture(autouse=True)
def reset_client():
    Client.reset_for_testing()
    yield
    Client.reset_for_testing()


# @scenario setup() with disable_sending=True disables sending on the client
def test_setup_forwards_disable_sending_true():
    client = langwatch.setup(
        api_key="test-key-776",
        skip_open_telemetry_setup=True,
        disable_sending=True,
    )

    assert client.disable_sending is True
    assert get_instance() is client


# @scenario setup() without disable_sending keeps sending enabled
def test_setup_defaults_to_sending_enabled():
    client = langwatch.setup(api_key="test-key-776", skip_open_telemetry_setup=True)

    assert client.disable_sending is False

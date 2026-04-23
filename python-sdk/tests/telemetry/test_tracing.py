# NOTE: This test will result in logs to the console about a missing LangWatch API key,
# which is expected as we don't care about integration-level API reporting in this test.

import json
import os
from uuid import uuid4

import httpx
import pytest

import langwatch
from langwatch.telemetry.tracing import LangWatchTrace


@pytest.fixture(scope="module", autouse=True)
def _ensure_tracer_installed():
    """Install a real TracerProvider so `with trace:` produces a recording root span.

    Without this, the OpenTelemetry default is a no-op tracer whose spans are
    NonRecordingSpan instances with no `.attributes`, so the test that reads
    `trace.root_span._span.attributes` falls over with an AttributeError.
    """
    prev_env_api_key = os.environ.get("LANGWATCH_API_KEY")
    prev_api_key = getattr(langwatch, "_api_key", None)
    prev_endpoint = getattr(langwatch, "_endpoint", None)

    os.environ["LANGWATCH_API_KEY"] = "test-key-for-tracing"
    langwatch._api_key = "test-key-for-tracing"
    langwatch._endpoint = "http://localhost:5560"
    try:
        langwatch.setup()
    except Exception:
        # Tracer may already be installed by a sibling test module.
        pass
    try:
        yield
    finally:
        if prev_env_api_key is None:
            os.environ.pop("LANGWATCH_API_KEY", None)
        else:
            os.environ["LANGWATCH_API_KEY"] = prev_env_api_key
        langwatch._api_key = prev_api_key
        langwatch._endpoint = prev_endpoint


def test_metadata_initialization_and_update_merge():
    # Initial metadata
    trace = LangWatchTrace(metadata={"foo": 1, "bar": 2})
    assert trace.metadata == {"foo": 1, "bar": 2}

    # Update with new metadata (should merge, not replace)
    trace.update(metadata={"baz": 3, "foo": 42})
    # 'foo' should be overwritten, 'bar' should remain, 'baz' should be added
    assert trace.metadata == {"foo": 42, "bar": 2, "baz": 3}

    # Update with metadata=None (should not clear metadata)
    trace.update(metadata=None)
    assert trace.metadata == {"foo": 42, "bar": 2, "baz": 3}

    # Update with another dict
    trace.update(metadata={"new": "val"})
    assert trace.metadata == {"foo": 42, "bar": 2, "baz": 3, "new": "val"}


def test_metadata_on_root_span():
    # Create trace with metadata and root span
    trace = LangWatchTrace(metadata={"a": 1, "b": 2})
    with trace:
        trace.update(metadata={"b": 3, "c": 4})
        # The root span's metadata attribute should match the merged metadata
        root_metadata = trace.root_span._span.attributes.get("metadata")

        assert json.loads(root_metadata) == {"a": 1, "b": 3, "c": 4}


def test_share_retries_on_transient_timeout(monkeypatch):
    """share() must retry on httpx.TimeoutException — fixes sdk-python-ci flake."""
    trace = LangWatchTrace()
    trace._trace_id = int(uuid4().hex, 16)

    call_count = {"n": 0}

    class _FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, url, headers=None, timeout=None):
            call_count["n"] += 1
            if call_count["n"] < 3:
                raise httpx.ReadTimeout("read operation timed out")
            return httpx.Response(
                200,
                json={"path": f"/share/fake-{call_count['n']}"},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(httpx, "Client", lambda: _FakeClient())
    # Collapse tenacity's exponential backoff so the test is fast.
    import time as time_module

    monkeypatch.setattr(time_module, "sleep", lambda *a, **kw: None)

    url = trace.share()

    assert call_count["n"] == 3, "expected 2 retries before success"
    assert url.endswith("/share/fake-3")


def test_share_gives_up_after_max_attempts(monkeypatch):
    """share() must raise once retries are exhausted — avoids silent hangs."""
    trace = LangWatchTrace()
    trace._trace_id = int(uuid4().hex, 16)

    call_count = {"n": 0}

    class _FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, url, headers=None, timeout=None):
            call_count["n"] += 1
            raise httpx.ReadTimeout("read operation timed out")

    monkeypatch.setattr(httpx, "Client", lambda: _FakeClient())
    import time as time_module

    monkeypatch.setattr(time_module, "sleep", lambda *a, **kw: None)

    with pytest.raises(httpx.ReadTimeout):
        trace.share()

    assert call_count["n"] == 3, "expected exactly 3 attempts (stop_after_attempt=3)"


def test_metadata_not_lost_on_multiple_updates():
    trace = LangWatchTrace(metadata={"x": 1})
    trace.update(metadata={"y": 2})
    trace.update(metadata={"z": 3})
    assert trace.metadata == {"x": 1, "y": 2, "z": 3}

    # Overwrite a key
    trace.update(metadata={"y": 99})
    assert trace.metadata == {"x": 1, "y": 99, "z": 3}

    # None update should not clear
    trace.update(metadata=None)
    assert trace.metadata == {"x": 1, "y": 99, "z": 3}

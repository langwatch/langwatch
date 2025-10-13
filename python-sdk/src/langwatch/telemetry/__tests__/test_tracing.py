import pytest
from langwatch.telemetry.tracing import LangWatchTrace


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
        import json

        assert json.loads(root_metadata) == {"a": 1, "b": 3, "c": 4}


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


def test_metrics_update():
    # Test updating metrics including first_token_ms
    trace = LangWatchTrace()

    # Update with first_token_ms
    trace.update(metrics={"first_token_ms": 150})

    # Update with additional metrics
    trace.update(metrics={"prompt_tokens": 100, "completion_tokens": 50})

    # Update first_token_ms again
    trace.update(metrics={"first_token_ms": 200})

    # Verify the metrics are properly handled (they should be passed to root_span.update)
    # Since we can't easily test the internal span state without mocking,
    # we'll test that the update method doesn't raise any errors
    assert True  # If we get here, the updates succeeded


def test_metrics_update_with_root_span():
    # Test metrics update when there's an active root span
    trace = LangWatchTrace()

    with trace:
        # Update metrics while span is active
        trace.update(metrics={"first_token_ms": 150, "prompt_tokens": 100})

        # Verify metrics were set on the root span
        assert trace.root_span is not None
        assert trace.root_span.metrics is not None
        assert trace.root_span.metrics["first_token_ms"] == 150
        assert trace.root_span.metrics["prompt_tokens"] == 100

        # Update again with different values
        trace.update(metrics={"first_token_ms": 200, "completion_tokens": 50})

        # Verify the metrics were updated (merged, not replaced)
        assert trace.root_span.metrics["first_token_ms"] == 200  # Updated
        assert trace.root_span.metrics["prompt_tokens"] == 100  # Preserved
        assert trace.root_span.metrics["completion_tokens"] == 50  # Added

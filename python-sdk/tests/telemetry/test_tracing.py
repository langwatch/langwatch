# NOTE: This test will result in logs to the console about a missing LangWatch API key,
# which is expected as we don't care about integration-level API reporting in this test.

import json
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

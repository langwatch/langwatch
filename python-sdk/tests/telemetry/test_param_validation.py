# NOTE: These tests verify that the SDK emits warnings for wrong parameter
# types, without breaking the application (no exceptions raised).

import warnings
import pytest
from langwatch.telemetry.tracing import LangWatchTrace
from langwatch.telemetry.span import LangWatchSpan

pytestmark = pytest.mark.integration


class TestTraceMetadataValidation:
    """LangWatchTrace validates the metadata parameter type."""

    def test_warns_when_metadata_is_string(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            trace = LangWatchTrace(metadata="bad-metadata")  # type: ignore[arg-type]
        assert any("metadata" in str(w.message) for w in caught)
        assert trace.metadata == {}

    def test_warns_when_metadata_labels_is_string(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            trace = LangWatchTrace(metadata={"user_id": "u-1", "labels": "production"})
        assert any("labels" in str(w.message) for w in caught)
        assert "labels" not in trace.metadata
        assert trace.metadata.get("user_id") == "u-1"


class TestTraceContextsValidation:
    """LangWatchTrace validates the contexts parameter type."""

    def test_warns_when_contexts_is_dict(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            LangWatchTrace(
                contexts={"document_id": "doc-1", "content": "text"},  # type: ignore[arg-type]
                skip_root_span=True,
            )
        assert any("contexts" in str(w.message) for w in caught)

    def test_warns_when_contexts_is_string(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            LangWatchTrace(contexts="raw text", skip_root_span=True)  # type: ignore[arg-type]
        assert any("contexts" in str(w.message) for w in caught)


class TestTraceEvaluationsValidation:
    """LangWatchTrace validates the evaluations parameter type."""

    def test_warns_when_evaluations_is_dict(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            LangWatchTrace(
                evaluations={"name": "answer-relevance", "status": "processed"},  # type: ignore[arg-type]
                skip_root_span=True,
            )
        assert any("evaluations" in str(w.message) for w in caught)


class TestTraceUpdateValidation:
    """LangWatchTrace.update() validates parameter types."""

    def test_update_warns_when_metadata_is_string(self):
        trace = LangWatchTrace(skip_root_span=True)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            trace.update(metadata="bad")  # type: ignore[arg-type]
        assert any("metadata" in str(w.message) for w in caught)

    def test_update_warns_when_metadata_labels_is_string(self):
        trace = LangWatchTrace(skip_root_span=True)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            trace.update(metadata={"user_id": "u-1", "labels": "env"})
        assert any("labels" in str(w.message) for w in caught)

    def test_update_warns_when_contexts_is_dict(self):
        trace = LangWatchTrace(skip_root_span=True)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            trace.update(contexts={"content": "text"})  # type: ignore[arg-type]
        assert any("contexts" in str(w.message) for w in caught)

    def test_update_with_invalid_metadata_keeps_existing_state(self):
        trace = LangWatchTrace(metadata={"user_id": "u-1"}, skip_root_span=True)
        with warnings.catch_warnings(record=True):
            warnings.simplefilter("always")
            trace.update(metadata="bad")  # type: ignore[arg-type]
        assert trace.metadata == {"user_id": "u-1"}

    def test_update_with_invalid_labels_keeps_existing_labels(self):
        trace = LangWatchTrace(metadata={"labels": ["production"]}, skip_root_span=True)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            trace.update(metadata={"user_id": "u-1", "labels": "bad"})
        assert any("labels" in str(w.message) for w in caught)
        assert trace.metadata["labels"] == ["production"]
        assert trace.metadata["user_id"] == "u-1"


class TestSpanUpdateContextsValidation:
    """LangWatchSpan.update() validates the contexts parameter type."""

    def test_update_warns_when_contexts_is_dict(self):
        trace = LangWatchTrace(skip_root_span=True)
        span = LangWatchSpan(trace=trace)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            span.update(contexts={"content": "text"})  # type: ignore[arg-type]
        assert any("contexts" in str(w.message) for w in caught)

    def test_update_warns_when_contexts_is_string(self):
        trace = LangWatchTrace(skip_root_span=True)
        span = LangWatchSpan(trace=trace)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            span.update(contexts="raw text chunk")  # type: ignore[arg-type]
        assert any("contexts" in str(w.message) for w in caught)

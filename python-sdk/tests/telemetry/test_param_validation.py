# NOTE: These tests verify that the SDK emits warnings for wrong parameter
# types, without breaking the application (no exceptions raised).

import warnings
from langwatch.telemetry.tracing import LangWatchTrace
from langwatch.telemetry.span import LangWatchSpan


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

    def test_no_warning_for_valid_metadata(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            trace = LangWatchTrace(metadata={"labels": ["production"]})
        label_warnings = [
            w for w in caught if "labels" in str(w.message) or "metadata" in str(w.message)
        ]
        assert len(label_warnings) == 0


class TestTraceContextsValidation:
    """LangWatchTrace validates the contexts parameter type."""

    def test_warns_when_contexts_is_dict(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            trace = LangWatchTrace(
                contexts={"document_id": "doc-1", "content": "text"},  # type: ignore[arg-type]
                skip_root_span=True,
            )
        assert any("contexts" in str(w.message) for w in caught)

    def test_warns_when_contexts_is_string(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            LangWatchTrace(contexts="raw text", skip_root_span=True)  # type: ignore[arg-type]
        assert any("contexts" in str(w.message) for w in caught)

    def test_no_warning_for_valid_contexts(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            LangWatchTrace(
                contexts=[{"document_id": "doc-1", "content": "text"}],
                skip_root_span=True,
            )
        context_warnings = [w for w in caught if "contexts" in str(w.message)]
        assert len(context_warnings) == 0


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

    def test_no_warning_for_valid_evaluations(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            LangWatchTrace(
                evaluations=[{"name": "answer-relevance", "status": "processed"}],
                skip_root_span=True,
            )
        eval_warnings = [w for w in caught if "evaluations" in str(w.message)]
        assert len(eval_warnings) == 0


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

    def test_update_no_warning_for_valid_contexts(self):
        trace = LangWatchTrace(skip_root_span=True)
        span = LangWatchSpan(trace=trace)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            span.update(contexts=[{"content": "text"}])
        context_warnings = [w for w in caught if "contexts" in str(w.message)]
        assert len(context_warnings) == 0

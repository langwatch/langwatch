import warnings

import pytest
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import (
    SimpleSpanProcessor,
    SpanExporter,
    SpanExportResult,
)

from langwatch.telemetry.tracing import LangWatchTrace


class RecordingExporter(SpanExporter):
    def __init__(self) -> None:
        self.spans: list[ReadableSpan] = []

    def export(self, spans: tuple[ReadableSpan, ...]) -> SpanExportResult:
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS


def provider_with(exporter: RecordingExporter) -> TracerProvider:
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider


# @scenario "A trace with string labels warns and is not exported"
def test_string_labels_warn_and_skip_export() -> None:
    exporter = RecordingExporter()

    with (
        pytest.warns(RuntimeWarning, match="labels must be a list of strings"),
        LangWatchTrace(
            metadata={"labels": "production"},  # type: ignore[dict-item]
            tracer_provider=provider_with(exporter),
            name="invalid-labels",
        ),
    ):
        pass

    assert exporter.spans == []


def test_non_string_label_warns_and_skips_export() -> None:
    exporter = RecordingExporter()

    with (
        pytest.warns(RuntimeWarning, match="labels must contain only strings"),
        LangWatchTrace(
            metadata={"labels": ["production", 7]},  # type: ignore[list-item]
            tracer_provider=provider_with(exporter),
            name="invalid-label-entry",
        ),
    ):
        pass

    assert exporter.spans == []


# @scenario "A trace with a list of string labels is exported normally"
def test_string_list_labels_export_without_warning() -> None:
    exporter = RecordingExporter()

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        with LangWatchTrace(
            metadata={"labels": ["production"]},
            tracer_provider=provider_with(exporter),
            name="valid-labels",
        ):
            pass

    assert caught == []
    assert [span.name for span in exporter.spans] == ["valid-labels"]

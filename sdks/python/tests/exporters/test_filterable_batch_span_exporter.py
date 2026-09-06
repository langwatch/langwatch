import pytest
from unittest.mock import MagicMock, patch
from typing import List, Optional, Any, Sequence, Dict

from langwatch.domain import SpanProcessingExcludeRule
from langwatch.exporters.filterable_batch_span_exporter import FilterableBatchSpanProcessor
from opentelemetry.sdk.trace import ReadableSpan, Event
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.trace import SpanContext, SpanKind, StatusCode, Link
from opentelemetry.sdk.util.instrumentation import InstrumentationScope
from opentelemetry.sdk.resources import Resource


# Mock classes needed for testing - making them more compatible with ReadableSpan
class MockReadableSpan(ReadableSpan):
    def __init__(self, name: str):
        self._name = name
        self._attributes: Dict[str, Any] = {}
        self._start_time = 0
        self._end_time = 1
        self._context = MagicMock(spec=SpanContext)
        self._kind = SpanKind.INTERNAL
        self._status = MagicMock(spec=StatusCode)
        self._events: List[Event] = []
        self._links: List[Link] = []
        self._resource = MagicMock(spec=Resource)
        self._instrumentation_scope = MagicMock(spec=InstrumentationScope)
        # Add other necessary attributes/methods if linter still complains

    @property
    def name(self) -> str:
        return self._name

    @property
    def context(self) -> SpanContext:
        return self._context

    @property
    def kind(self) -> SpanKind:
        return self._kind

    @property
    def parent(self) -> Optional[SpanContext]:
        return None # Or mock if needed

    @property
    def start_time(self) -> Optional[int]:
        return self._start_time

    @property
    def end_time(self) -> Optional[int]:
        return self._end_time

    @property
    def status(self) -> Any: # Using Any for simplicity with MagicMock status
        return self._status

    @property
    def attributes(self) -> Dict[str, Any]:
        return self._attributes

    @property
    def events(self) -> List[Event]:
        return self._events

    @property
    def links(self) -> List[Link]:
        return self._links

    @property
    def resource(self) -> Resource:
        return self._resource

    @property
    def instrumentation_scope(self) -> InstrumentationScope:
        return self._instrumentation_scope

    def get_span_context(self) -> SpanContext:
        return self._context

    def to_json(self, *args: Any, **kwargs: Any) -> str:
        return "{}" # Dummy implementation

    def is_recording(self) -> bool:
        return False # Dummy implementation

class MockSpanExporter(SpanExporter):
    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        # Dummy implementation - can add logic here if needed for other tests
        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        pass

    def force_flush(self, timeout_millis: Optional[int] = None) -> bool:
        return True # Dummy implementation


@pytest.fixture
def mock_exporter() -> SpanExporter:
    return MockSpanExporter()

# Test cases
def test_span_passes_with_no_rules(mock_exporter: SpanExporter):
    """Test that a span is processed when no exclude rules are provided."""
    processor = FilterableBatchSpanProcessor(
        span_exporter=mock_exporter,
        exclude_rules=[],
        schedule_delay_millis=100,
        max_queue_size=10,
        max_export_batch_size=5,
        export_timeout_millis=1000,
    )
    span = MockReadableSpan("test_span_name")

    with patch('opentelemetry.sdk.trace.export.BatchSpanProcessor.on_end', autospec=True) as mock_parent_on_end:
         processor.on_end(span)
         mock_parent_on_end.assert_called_once_with(processor, span)


def test_span_passes_when_no_rule_matches(mock_exporter: SpanExporter):
    """Test that a span is processed when it doesn't match any exclude rule."""
    rules = [
        SpanProcessingExcludeRule(field_name="span_name", match_value="exclude_this", match_operation="exact_match")
    ]
    processor = FilterableBatchSpanProcessor(
        span_exporter=mock_exporter,
        exclude_rules=rules,
        schedule_delay_millis=100,
        max_queue_size=10,
        max_export_batch_size=5,
        export_timeout_millis=1000,
    )
    span = MockReadableSpan("include_this_span")

    with patch('opentelemetry.sdk.trace.export.BatchSpanProcessor.on_end', autospec=True) as mock_parent_on_end:
        processor.on_end(span)
        mock_parent_on_end.assert_called_once_with(processor, span)

@pytest.mark.parametrize("span_name_to_exclude, rule_value, operation", [
    ("exclude_me", "exclude_me", "exact_match"),
    ("prefix_exclude_me", "prefix_", "starts_with"),
    ("exclude_me_suffix", "_suffix", "ends_with"),
    ("contains_exclude_me_string", "exclude_me", "includes"),
])
def test_span_is_excluded_by_rule(mock_exporter: SpanExporter, span_name_to_exclude: str, rule_value: str, operation: str):
    """Test that a span is excluded when it matches an exclude rule."""
    rules = [
        SpanProcessingExcludeRule(field_name="span_name", match_value=rule_value, match_operation=operation) # type: ignore
    ]
    processor = FilterableBatchSpanProcessor(
        span_exporter=mock_exporter,
        exclude_rules=rules,
        schedule_delay_millis=100,
        max_queue_size=10,
        max_export_batch_size=5,
        export_timeout_millis=1000,
    )
    span = MockReadableSpan(span_name_to_exclude)

    with patch('opentelemetry.sdk.trace.export.BatchSpanProcessor.on_end', autospec=True) as mock_parent_on_end:
        processor.on_end(span)
        mock_parent_on_end.assert_not_called()


def test_span_is_excluded_by_one_of_multiple_rules(mock_exporter: SpanExporter):
    """Test that a span is excluded if it matches any one of multiple rules."""
    rules = [
        SpanProcessingExcludeRule(field_name="span_name", match_value="other_span", match_operation="exact_match"),
        SpanProcessingExcludeRule(field_name="span_name", match_value="exclude_me", match_operation="includes"),
        SpanProcessingExcludeRule(field_name="span_name", match_value="dont_match", match_operation="starts_with"),
    ]
    processor = FilterableBatchSpanProcessor(
        span_exporter=mock_exporter,
        exclude_rules=rules,
        schedule_delay_millis=100,
        max_queue_size=10,
        max_export_batch_size=5,
        export_timeout_millis=1000,
    )
    span = MockReadableSpan("this_contains_exclude_me")

    with patch('opentelemetry.sdk.trace.export.BatchSpanProcessor.on_end', autospec=True) as mock_parent_on_end:
        processor.on_end(span)
        mock_parent_on_end.assert_not_called() 

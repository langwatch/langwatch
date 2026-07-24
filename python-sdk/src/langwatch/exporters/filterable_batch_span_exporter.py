import logging
from typing import List

from langwatch.domain import SpanProcessingExcludeRule
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExporter

logger = logging.getLogger(__name__)


class FilterableBatchSpanProcessor(BatchSpanProcessor):
    """
    A BatchSpanProcessor that filters spans based on exclude rules before batching.
    """

    def __init__(
        self,
        span_exporter: SpanExporter,
        exclude_rules: List[SpanProcessingExcludeRule],
        schedule_delay_millis: float,
        max_queue_size: int,
        max_export_batch_size: int,
        export_timeout_millis: float,
    ):
        super().__init__(
            span_exporter,
            schedule_delay_millis=schedule_delay_millis,
            max_queue_size=max_queue_size,
            max_export_batch_size=max_export_batch_size,
            export_timeout_millis=export_timeout_millis,
        )
        self._exclude_rules = exclude_rules or []

    def on_end(self, span: ReadableSpan) -> None:
        """
        Called when a span ends. Filters the span based on exclusion rules
        before passing it to the parent processor.
        """
        is_excluded = False
        for rule in self._exclude_rules:
            if rule.field_name == "span_name":
                span_name = span.name
                match_value = rule.match_value
                match_operation = rule.match_operation

                if match_operation == "exact_match" and span_name == match_value:
                    is_excluded = True
                    break
                elif match_operation == "includes" and match_value in span_name:
                    is_excluded = True
                    break
                elif match_operation == "starts_with" and span_name.startswith(match_value):
                    is_excluded = True
                    break
                elif match_operation == "ends_with" and span_name.endswith(match_value):
                    is_excluded = True
                    break

        if not is_excluded:
            super().on_end(span)

"""Unit tests for the trace id an experiment records alongside its results.

A recorded result is only useful if it joins back to the trace that produced
it, and that join is a string comparison. So the id an evaluation carries has
to be byte-identical to the one the dataset entry and the span carry, on every
trace and not just on the 255 out of 256 that happen to start with a non-zero
byte.
"""

import time

import pytest
from opentelemetry import trace as otel_trace
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags

from langwatch.experiment.experiment import Experiment, _current_trace_id

pytestmark = pytest.mark.unit

# A trace id whose first twelve bytes are zero, the case an unpadded hex
# encoding silently shortens.
LEADING_ZEROS_TRACE_ID = 0x0000000000000000000000004AF2B31D
LEADING_ZEROS_TRACE_ID_HEX = "0000000000000000000000004af2b31d"


def _span_with(trace_id: int) -> NonRecordingSpan:
    return NonRecordingSpan(
        SpanContext(
            trace_id=trace_id,
            span_id=0x00000000000000AB,
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
        )
    )


@pytest.fixture
def experiment() -> Experiment:
    """An experiment that never flushes its batch during a test."""
    exp = Experiment("trace-id-test")
    exp.initialized = True
    exp.last_sent = time.time() + 100000
    return exp


class TestGivenATraceIdStartingWithAZeroByte:
    def test_encodes_it_to_the_full_thirty_two_characters(self):
        with otel_trace.use_span(
            _span_with(LEADING_ZEROS_TRACE_ID), end_on_exit=False
        ):
            assert _current_trace_id() == LEADING_ZEROS_TRACE_ID_HEX

    def test_a_logged_evaluation_carries_the_same_id_as_the_span(
        self, experiment
    ):
        span = _span_with(LEADING_ZEROS_TRACE_ID)

        with otel_trace.use_span(span, end_on_exit=False):
            experiment.log("accuracy", 0, score=1.0)

        entry = experiment.batch["evaluations"][0]
        assert entry.trace_id == format(
            span.get_span_context().trace_id, "032x"
        )
        assert entry.trace_id == LEADING_ZEROS_TRACE_ID_HEX


class TestGivenNoSpanIsActive:
    def test_reports_the_invalid_trace_id_rather_than_a_short_one(self):
        with otel_trace.use_span(otel_trace.INVALID_SPAN, end_on_exit=False):
            assert _current_trace_id() == "0" * 32

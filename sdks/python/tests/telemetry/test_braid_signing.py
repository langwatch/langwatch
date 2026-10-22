# Signed calls for braids, wire format version 1 (ADR-183 section 4).
# The pinned signature is asserted identically in
# sdks/typescript/src/observability-sdk/braids/__tests__/braids.unit.test.ts
# and sdks/go/braids_test.go. See sdks/typescript/specs/telemetry/braid-signing.feature

import base64
import json
from collections.abc import Sequence

import pytest
from opentelemetry import baggage, trace
from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.context import Context
from opentelemetry.propagators.composite import CompositePropagator
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import (
    SimpleSpanProcessor,
    SpanExporter,
    SpanExportResult,
)
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from langwatch.braids import (
    BRAID_SIGNATURE_KEY,
    BraidBaggageSpanProcessor,
    BraidSigningError,
    compute_braid_signature,
    sign_baggage,
)

SIGNING_KEY = "lwsk_testkid_testsecret"
TRACE_ID = "0af7651916cd43dd8448eb211c80319c"
ENTRIES = {"orchestrator": "web", "team": "a"}
PINNED_SIGNATURE = "eyJ2IjoxLCJraWQiOiJ0ZXN0a2lkIiwia2V5cyI6WyJvcmNoZXN0cmF0b3IiLCJ0ZWFtIl0sInNpZyI6IjFNWGtzUVIzc25vdVBZV0Z4TzVDZnlyRzY2WUQ1MzlhbmNlbWVRaG9VazQifQ"
# orchestrator "web" alone in TRACE_ID. The API key module verifies this exact value
# (modules/api-key/process/src/services/__tests__/signing-key.signed-calls.service.unit.test.ts).
CALL_SIGNATURE = "eyJ2IjoxLCJraWQiOiJ0ZXN0a2lkIiwia2V5cyI6WyJvcmNoZXN0cmF0b3IiXSwic2lnIjoiSjg2RU1MejJXUVZlZkpLN1BfN1R2UmEtdzRvR000TG96bjhlZTNMd0kyRSJ9"


class _InMemoryExporter(SpanExporter):
    def __init__(self) -> None:
        self.spans: list[ReadableSpan] = []

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        pass


def _context_in_trace() -> Context:
    span_context = SpanContext(
        trace_id=int(TRACE_ID, 16),
        span_id=int("b7ad6b7169203331", 16),
        is_remote=True,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )
    return trace.set_span_in_context(NonRecordingSpan(span_context), Context())


def _start_span_under(copy_entries: list[str], ctx: Context) -> ReadableSpan:
    exporter = _InMemoryExporter()
    provider = TracerProvider()
    provider.add_span_processor(BraidBaggageSpanProcessor(copy_entries))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    provider.get_tracer("braids-test").start_span("called", context=ctx).end()
    return exporter.spans[0]


def test_pinned_vector_produces_the_shared_signature():
    signature = compute_braid_signature(
        SIGNING_KEY, TRACE_ID, {"team": "a", "orchestrator": "web"}
    )
    assert signature == PINNED_SIGNATURE
    padded = signature + "=" * (-len(signature) % 4)
    assert json.loads(base64.urlsafe_b64decode(padded)) == {
        "v": 1,
        "kid": "testkid",
        "keys": ["orchestrator", "team"],
        "sig": "1MXksQR3snouPYWFxO5CfyrG66YD539ancemeQhoUk4",
    }


def test_signing_puts_each_entry_and_the_signature_in_baggage():
    ctx = sign_baggage(SIGNING_KEY, ENTRIES, _context_in_trace())
    assert baggage.get_baggage("orchestrator", ctx) == "web"
    assert baggage.get_baggage("team", ctx) == "a"
    assert baggage.get_baggage(BRAID_SIGNATURE_KEY, ctx) == PINNED_SIGNATURE


@pytest.mark.parametrize(
    "signing_key",
    [
        "not-a-key",
        "lwsk_",
        "lwsk_kid",
        "lwsk__secret",
        "lwsk_kid_",
        "lwsk_k-id_secret",
        "lwsk_k.id_secret",
        "lwsk_kïd_secret",
    ],
)
def test_malformed_signing_key_is_refused(signing_key: str):
    with pytest.raises(BraidSigningError) as error:
        sign_baggage(signing_key, ENTRIES, _context_in_trace())
    assert error.value.code == "malformed_signing_key"


@pytest.mark.parametrize("key", ["bad key", "", "x" * 129, "é", BRAID_SIGNATURE_KEY])
def test_entry_key_outside_the_pattern_is_refused(key: str):
    with pytest.raises(BraidSigningError) as error:
        sign_baggage(SIGNING_KEY, {key: "v"}, _context_in_trace())
    assert error.value.code == "invalid_entry_key"


@pytest.mark.parametrize("value", ["x\nteam=a", "x\r", "\n"])
def test_entry_value_holding_a_line_break_is_refused(value: str):
    with pytest.raises(BraidSigningError) as error:
        sign_baggage(SIGNING_KEY, {"orchestrator": value}, _context_in_trace())
    assert error.value.code == "invalid_entry_value"


def test_empty_entries_are_refused():
    with pytest.raises(BraidSigningError) as error:
        sign_baggage(SIGNING_KEY, {}, _context_in_trace())
    assert error.value.code == "empty_entries"


def test_signing_outside_a_trace_is_refused():
    with pytest.raises(BraidSigningError) as error:
        sign_baggage(SIGNING_KEY, ENTRIES, Context())
    assert error.value.code == "no_active_trace"


def test_span_under_signed_baggage_carries_the_entries_and_the_signature():
    ctx = sign_baggage(SIGNING_KEY, ENTRIES, _context_in_trace())
    span = _start_span_under(["orchestrator", "team"], ctx)
    assert span.attributes is not None
    assert span.attributes["orchestrator"] == "web"
    assert span.attributes["team"] == "a"
    assert span.attributes[BRAID_SIGNATURE_KEY] == PINNED_SIGNATURE
    assert format(span.context.trace_id, "032x") == TRACE_ID


# @scenario "The <language> SDK signs the named entries and copies them onto spans"
def test_called_service_spans_carry_the_signed_entry_and_its_signature():
    wire = CompositePropagator(
        [TraceContextTextMapPropagator(), W3CBaggagePropagator()]
    )
    headers: dict[str, str] = {}
    calling = sign_baggage(SIGNING_KEY, {"orchestrator": "web"}, _context_in_trace())
    wire.inject(headers, context=calling)

    exporter = _InMemoryExporter()
    provider = TracerProvider()
    provider.add_span_processor(BraidBaggageSpanProcessor(["orchestrator"]))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    called = provider.get_tracer("called-service")
    received = wire.extract(headers)
    handler = called.start_span("handle call", context=received)
    called.start_span(
        "tool", context=trace.set_span_in_context(handler, received)
    ).end()
    handler.end()

    assert len(exporter.spans) == 2
    for span in exporter.spans:
        assert format(span.context.trace_id, "032x") == TRACE_ID
        assert span.attributes is not None
        assert span.attributes["orchestrator"] == "web"
        assert span.attributes[BRAID_SIGNATURE_KEY] == CALL_SIGNATURE


def test_entries_not_named_stay_off_the_span():
    ctx = baggage.set_baggage("orchestrator", "web", _context_in_trace())
    ctx = baggage.set_baggage("secretish", "x", ctx)
    span = _start_span_under(["orchestrator"], ctx)
    assert span.attributes is not None
    assert span.attributes["orchestrator"] == "web"
    assert "secretish" not in span.attributes

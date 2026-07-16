package otelrelay

import (
	"strings"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/trace"
)

// Reserved resource-attribute keys the LangWatch OTLP ingest maps onto trace
// metadata (see specs/langy/langy-otel-tracing.feature): tag.tags becomes the
// trace's labels, langwatch.thread.id its thread grouping.
const (
	attrTags     = "tag.tags"
	attrThreadID = "langwatch.thread.id"
	langyTag     = "langy"
)

// ReparentOTLP rewrites one exported OTLP trace batch so it belongs to the
// conversation's turn:
//
//   - every span's trace id becomes the turn's trace id, so the worker's
//     activity lands in the SAME trace as the app -> control-plane -> manager
//     spans (opencode speaks no W3C propagation; this is where continuity is
//     restored);
//   - every ROOT span (empty parent span id) is parented on the turn's span;
//     non-root spans keep their span ids and parent links, so the worker's own
//     internal hierarchy survives intact;
//   - the resource is stamped with the reserved LangWatch keys (tag.tags=langy,
//     langwatch.thread.id=<conversation>) so the trace is labeled and grouped
//     regardless of what the worker set.
//
// When turn is not (yet) valid — a span batch racing the first turn, or
// telemetry disabled upstream — the batch is forwarded UNMODIFIED apart from
// the resource stamp: an own-trace-id batch in the right project beats a
// dropped one.
//
// Protobuf only: the worker env pins OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf,
// so that is the one wire shape this relay speaks (in and out).
func ReparentOTLP(payload []byte, conversationID string, turn trace.SpanContext) ([]byte, error) {
	td, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(payload)
	if err != nil {
		return nil, err
	}
	ReparentTraces(td, conversationID, turn)
	return (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
}

// ReparentTraces applies the rewrite in place. Split from ReparentOTLP so the
// id-rewriting logic unit-tests against pdata values without codec round-trips.
func ReparentTraces(td ptrace.Traces, conversationID string, turn trace.SpanContext) {
	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		rs := rss.At(i)
		stampResource(rs.Resource().Attributes(), conversationID)
		if !turn.IsValid() {
			continue
		}
		turnTraceID := pcommon.TraceID(turn.TraceID())
		turnSpanID := pcommon.SpanID(turn.SpanID())
		sss := rs.ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				span := spans.At(k)
				span.SetTraceID(turnTraceID)
				if span.ParentSpanID().IsEmpty() {
					span.SetParentSpanID(turnSpanID)
				}
			}
		}
	}
}

// stampResource sets the reserved LangWatch keys, appending "langy" to any
// existing tag.tags value (comma-separated, the shape the ingest accepts)
// rather than clobbering a tag the worker legitimately set.
func stampResource(attrs pcommon.Map, conversationID string) {
	attrs.PutStr(attrThreadID, conversationID)
	if existing, ok := attrs.Get(attrTags); ok {
		tags := existing.AsString()
		if tags != "" && !containsTag(tags, langyTag) {
			attrs.PutStr(attrTags, tags+","+langyTag)
			return
		}
		if tags != "" {
			return
		}
	}
	attrs.PutStr(attrTags, langyTag)
}

func containsTag(csv, tag string) bool {
	for _, t := range strings.Split(csv, ",") {
		if strings.TrimSpace(t) == tag {
			return true
		}
	}
	return false
}

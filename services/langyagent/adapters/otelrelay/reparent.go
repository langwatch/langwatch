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
	attrOrigin   = "langwatch.origin"
	attrUserID   = "langwatch.user.id"
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
//     langwatch.thread.id=<conversation>, langwatch.user.id=<acting user>) so
//     the trace is labeled, grouped, and attributed to the acting user
//     regardless of what the worker set. actorUserID is the manager-held
//     identity, not a worker-supplied attribute.
//
// When turn is not (yet) valid — a span batch racing the first turn, or
// telemetry disabled upstream — the batch is forwarded UNMODIFIED apart from
// the resource stamp: an own-trace-id batch in the right project beats a
// dropped one.
//
// Protobuf only: the worker env pins OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf,
// so that is the one wire shape this relay speaks (in and out).
func ReparentOTLP(payload []byte, conversationID, actorUserID string, turn trace.SpanContext) ([]byte, error) {
	td, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(payload)
	if err != nil {
		return nil, err
	}
	ReparentTraces(td, conversationID, actorUserID, turn)
	return (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
}

// ReparentTraces applies the rewrite in place. Split from ReparentOTLP so the
// id-rewriting logic unit-tests against pdata values without codec round-trips.
func ReparentTraces(td ptrace.Traces, conversationID, actorUserID string, turn trace.SpanContext) {
	rss := td.ResourceSpans()
	isTurnValid := turn.IsValid()
	turnTraceID := pcommon.TraceID(turn.TraceID())
	turnSpanID := pcommon.SpanID(turn.SpanID())
	for i := 0; i < rss.Len(); i++ {
		rs := rss.At(i)
		stampResource(rs.Resource().Attributes(), conversationID, actorUserID)
		sss := rs.ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			ss := sss.At(j)
			// The provenance strip runs for every batch, including one that
			// arrives before the turn exists: an unreparented batch is still
			// forwarded to the customer, so skipping it here would leave the
			// forgery open on precisely that path.
			stripForgedOrigin(ss.Scope().Attributes())
			spans := ss.Spans()
			for k := 0; k < spans.Len(); k++ {
				span := spans.At(k)
				stripForgedOrigin(span.Attributes())
				if !isTurnValid {
					continue
				}
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
//
// It also REMOVES langwatch.origin: that key is LangWatch's provenance marker
// (pkg/otelsetup stamps platform_internal, the relay's internal copy stamps
// langy_worker) and the worker — a model-driven, prompt-injectable process —
// must not be able to brand its spans with it in the customer's project.
// Ingest-side enforcement keyed on the marker must never trust a
// worker-supplied value.
//
// Every removal here sweeps ALL entries for the key, never just the first.
// The worker writes its own OTLP bytes, and the wire format is a repeated
// list of key/value pairs that the unmarshaler preserves verbatim — so a key
// present twice survives a first-match Remove, and Get/PutStr would read and
// overwrite only the leading copy while the worker's twin rode through
// untouched.
func stampResource(attrs pcommon.Map, conversationID, actorUserID string) {
	removeAll(attrs, attrOrigin)

	tags := firstValue(attrs, attrTags)
	removeAll(attrs, attrThreadID)
	removeAll(attrs, attrTags)
	// Overwrite, never merge: the acting user is the manager's, and a worker
	// value here would be a spend-attribution forgery. Empty only in partial
	// wiring / tests, where we leave the key unset rather than stamp "".
	removeAll(attrs, attrUserID)
	if actorUserID != "" {
		attrs.PutStr(attrUserID, actorUserID)
	}

	attrs.PutStr(attrThreadID, conversationID)
	switch {
	case tags == "":
		attrs.PutStr(attrTags, langyTag)
	case containsTag(tags, langyTag):
		attrs.PutStr(attrTags, tags)
	default:
		attrs.PutStr(attrTags, tags+","+langyTag)
	}
}

// stripForgedOrigin removes the provenance marker from a span or scope. Ingest
// resolves a span-level langwatch.origin BEFORE falling back to the resource
// (see trace-origin.service.ts), so stripping the resource alone would leave
// the higher-precedence claim in place.
func stripForgedOrigin(attrs pcommon.Map) {
	removeAll(attrs, attrOrigin)
}

// removeAll deletes every entry for key, unlike Map.Remove which returns after
// the first match.
func removeAll(attrs pcommon.Map, key string) {
	attrs.RemoveIf(func(k string, _ pcommon.Value) bool { return k == key })
}

// firstValue returns the leading value for key, or "" when absent. The leading
// copy is the one ingest would have read, so it is the one whose legitimate
// content is preserved when the key is rewritten.
func firstValue(attrs pcommon.Map, key string) string {
	if v, ok := attrs.Get(key); ok {
		return v.AsString()
	}
	return ""
}

func containsTag(csv, tag string) bool {
	for _, t := range strings.Split(csv, ",") {
		if strings.TrimSpace(t) == tag {
			return true
		}
	}
	return false
}

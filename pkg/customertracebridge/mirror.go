package customertracebridge

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// mirrorExporter is the gateway half of the ADR-061 mirror lane. The gateway
// emits one gen_ai span per LLM call into the customer's project; that span is
// the one piece of a Langy turn's trace the manager's relay never sees (the
// gen_ai spans are synthesised here, not exported by the worker). So the mirror
// is completed HERE: a span EndSpan marked with a non-skip tier is DUPLICATED
// into the mirror project, at the fidelity the tier allows.
//
//   - content    — the mirror copy carries the prompt + completion verbatim.
//   - structural — the mirror copy has the message bodies removed; timings,
//     usage, cost, status and model survive.
//
// The reserved marker attributes are stripped from BOTH copies: they are
// internal signalling and must reach neither project. The customer's own copy
// is otherwise untouched — the mirror leg can only ADD a copy, never alter or
// withhold the customer's.
//
// tracetest is imported in production code deliberately: ReadOnlySpan is a
// sealed interface, and SpanStub is the SDK's only public way to rebuild one
// with chosen attributes.
type mirrorExporter struct {
	inner           sdktrace.SpanExporter
	mirrorProjectID string
}

func (m mirrorExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	// Own slice: the batch's backing array belongs to the processor and must not
	// be mutated (the SpanExporter contract).
	out := make([]sdktrace.ReadOnlySpan, 0, len(spans)+1)
	for _, s := range spans {
		tier := spanAttr(s, attrMirrorTier)
		// The customer copy, always — with the reserved markers stripped.
		out = append(out, stripMarkers(s))
		if tier != mirrorTierContent && tier != mirrorTierStructural {
			continue
		}
		out = append(out, m.mirrorCopy(s, tier))
	}
	return m.inner.ExportSpans(ctx, out)
}

func (m mirrorExporter) Shutdown(ctx context.Context) error { return m.inner.Shutdown(ctx) }

// mirrorCopy rebuilds a span for the mirror project: re-homed by project id,
// attributed to the source organization, content gated by tier, markers gone.
func (m mirrorExporter) mirrorCopy(s sdktrace.ReadOnlySpan, tier string) sdktrace.ReadOnlySpan {
	stub := tracetest.SpanStubFromReadOnlySpan(s)
	sourceOrg := spanAttr(s, attrMirrorSourceOrg)

	kept := make([]attribute.KeyValue, 0, len(stub.Attributes)+2)
	for _, a := range stub.Attributes {
		switch a.Key {
		case attrMirrorTier, attrMirrorSourceOrg:
			// reserved markers never travel
			continue
		case attrProjectID:
			// re-home to the mirror project so the router delivers it there
			continue
		case attrInputMessages, attrOutputMessages:
			// message bodies ride only at the content tier
			if tier == mirrorTierStructural {
				continue
			}
			kept = append(kept, a)
		default:
			kept = append(kept, a)
		}
	}
	kept = append(kept, attrProjectID.String(m.mirrorProjectID))
	if sourceOrg != "" {
		// Source-tenant attribution (ADR-053 Track A org identifier). The source
		// PROJECT id is langwatch.project_id, which the router owns here, so the
		// gateway leg attributes at the org level; the relay leg carries both.
		kept = append(kept, attrOrgID.String(sourceOrg))
	}
	stub.Attributes = kept
	return stub.Snapshot()
}

// stripMarkers returns the span with only the reserved mirror markers removed,
// so the customer's own copy never carries internal signalling.
func stripMarkers(s sdktrace.ReadOnlySpan) sdktrace.ReadOnlySpan {
	// Fast path: nothing to strip.
	if spanAttr(s, attrMirrorTier) == "" && spanAttr(s, attrMirrorSourceOrg) == "" {
		return s
	}
	stub := tracetest.SpanStubFromReadOnlySpan(s)
	kept := make([]attribute.KeyValue, 0, len(stub.Attributes))
	for _, a := range stub.Attributes {
		if a.Key == attrMirrorTier || a.Key == attrMirrorSourceOrg {
			continue
		}
		kept = append(kept, a)
	}
	stub.Attributes = kept
	return stub.Snapshot()
}

func spanAttr(s sdktrace.ReadOnlySpan, key attribute.Key) string {
	for _, a := range s.Attributes() {
		if a.Key == key {
			return a.Value.AsString()
		}
	}
	return ""
}

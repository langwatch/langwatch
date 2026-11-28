package customertracebridge

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// mirrorExporter is the gateway half of the ADR-061 mirror lane. The gateway
// emits one gen_ai span per LLM call into the customer's project; that span is
// the one piece of a Langy turn's trace the manager's relay never sees (the
// gen_ai spans are synthesized here, not exported by the worker). So the mirror
// is completed HERE: a span EndSpan marked with a non-skip tier is DUPLICATED
// into the mirror project, at the fidelity the tier allows.
//
//   - content    — the mirror copy carries the prompt + completion verbatim.
//   - structural — the mirror copy has the message bodies removed; timings,
//     usage, cost, status and model survive.
//
// The reserved marker attributes must reach neither project: the mirror copy
// is rebuilt without them here, and resourceScrubExporter, which sits inside
// this exporter, removes them from every span it sends. The customer's own copy
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
		// The customer copy, always. The scrub stage inside strips its markers.
		out = append(out, s)
		if tier != mirrorTierContent && tier != mirrorTierStructural {
			continue
		}
		out = append(out, m.mirrorCopy(s, tier))
	}
	return m.inner.ExportSpans(ctx, out)
}

func (m mirrorExporter) Shutdown(ctx context.Context) error { return m.inner.Shutdown(ctx) }

// mirrorCopy rebuilds a span for the mirror project: re-homed by project id,
// tagged with its source tenant, content gated by tier, markers gone. The
// source tenant rides as reserved copy markers that resourceScrubExporter lifts
// onto the resource, the one place ADR-061 §5 puts it.
func (m mirrorExporter) mirrorCopy(s sdktrace.ReadOnlySpan, tier string) sdktrace.ReadOnlySpan {
	stub := tracetest.SpanStubFromReadOnlySpan(s)
	sourceOrg := spanAttr(s, attrMirrorSourceOrg)
	sourceProject := spanAttr(s, attrProjectID)

	kept := make([]attribute.KeyValue, 0, len(stub.Attributes)+3)
	for _, a := range stub.Attributes {
		switch {
		case isMirrorMarker(a.Key):
			// reserved markers never travel
			continue
		case a.Key == attrProjectID:
			// re-home to the mirror project so the router delivers it there
			continue
		case a.Key == attrInputMessages, a.Key == attrOutputMessages:
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
		kept = append(kept, attrMirrorCopySourceOrg.String(sourceOrg))
	}
	if sourceProject != "" {
		kept = append(kept, attrMirrorCopySourceProject.String(sourceProject))
	}
	stub.Attributes = kept
	return stub.Snapshot()
}

// isMirrorMarker reports the reserved ADR-061 keys that steer the mirror leg
// inside this package and must reach neither project as span attributes.
func isMirrorMarker(key attribute.Key) bool {
	switch key {
	case attrMirrorTier, attrMirrorSourceOrg, attrMirrorCopySourceOrg, attrMirrorCopySourceProject:
		return true
	}
	return false
}

// withoutMirrorMarkers returns attrs without the reserved mirror markers. It
// returns attrs itself when there is nothing to remove.
func withoutMirrorMarkers(attrs []attribute.KeyValue) []attribute.KeyValue {
	for i, a := range attrs {
		if !isMirrorMarker(a.Key) {
			continue
		}
		kept := make([]attribute.KeyValue, 0, len(attrs)-1)
		kept = append(kept, attrs[:i]...)
		for _, b := range attrs[i+1:] {
			if !isMirrorMarker(b.Key) {
				kept = append(kept, b)
			}
		}
		return kept
	}
	return attrs
}

// withMirrorSource adds a mirror copy's source tenant to its policy-built
// resource, as langwatch.organization_id and langwatch.project_id, the keys the
// relay's mirror copies carry. A span with no copy markers (every customer
// copy) keeps the resource unchanged.
func withMirrorSource(res *resource.Resource, attrs []attribute.KeyValue) *resource.Resource {
	var source []attribute.KeyValue
	for _, a := range attrs {
		switch a.Key {
		case attrMirrorCopySourceOrg:
			source = append(source, attrOrgID.String(a.Value.AsString()))
		case attrMirrorCopySourceProject:
			source = append(source, attrProjectID.String(a.Value.AsString()))
		}
	}
	if len(source) == 0 {
		return res
	}
	return resource.NewSchemaless(append(res.Attributes(), source...)...)
}

func spanAttr(s sdktrace.ReadOnlySpan, key attribute.Key) string {
	for _, a := range s.Attributes() {
		if a.Key == key {
			return a.Value.AsString()
		}
	}
	return ""
}

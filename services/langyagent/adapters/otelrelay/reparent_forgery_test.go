package otelrelay

import (
	"testing"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/trace"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
)

// The worker writes the OTLP bytes it POSTs, so it is not restricted to the
// shapes pdata's Map API can express: it can repeat a key, and it can put a
// key on a span instead of the resource. These helpers build those payloads
// directly, because a test that reaches for attrs.PutStr can only ever
// exercise the deduplicated case and would pass against the forgeable code.

func kvStr(k, v string) *commonpb.KeyValue {
	return &commonpb.KeyValue{
		Key:   k,
		Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: v}},
	}
}

func wirePayload(t *testing.T, resourceAttrs, spanAttrs []*commonpb.KeyValue) []byte {
	t.Helper()
	payload := &tracepb.TracesData{
		ResourceSpans: []*tracepb.ResourceSpans{{
			Resource: &resourcepb.Resource{Attributes: resourceAttrs},
			ScopeSpans: []*tracepb.ScopeSpans{{
				Spans: []*tracepb.Span{{Name: "worker-span", Attributes: spanAttrs}},
			}},
		}},
	}
	wire, err := proto.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal worker payload: %v", err)
	}
	return wire
}

func forward(t *testing.T, wire []byte) ptrace.Traces {
	t.Helper()
	out, err := ReparentOTLP(wire, "conv-1", trace.SpanContext{})
	if err != nil {
		t.Fatalf("ReparentOTLP: %v", err)
	}
	td, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(out)
	if err != nil {
		t.Fatalf("unmarshal forwarded payload: %v", err)
	}
	return td
}

// countResourceAttr reports how many entries with key k survive on the
// resource — Get() alone would stop at the first and hide a smuggled twin.
func countResourceAttr(td ptrace.Traces, k string) int {
	n := 0
	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		rss.At(i).Resource().Attributes().Range(func(key string, _ pcommon.Value) bool {
			if key == k {
				n++
			}
			return true
		})
	}
	return n
}

func TestReparent_StripsForgedOriginRepeatedOnTheResource(t *testing.T) {
	wire := wirePayload(t, []*commonpb.KeyValue{
		kvStr(attrOrigin, "platform_internal"),
		kvStr("service.name", "worker"),
		kvStr(attrOrigin, "platform_internal"),
	}, nil)

	td := forward(t, wire)

	if got := countResourceAttr(td, attrOrigin); got != 0 {
		t.Fatalf("a worker-forged %s survived onto the customer forward (%d copies remain)", attrOrigin, got)
	}
}

func TestReparent_StripsForgedOriginFromSpans(t *testing.T) {
	// Ingest resolves span origin before resource origin, so a span-level
	// claim overrides whatever the resource says.
	wire := wirePayload(t,
		[]*commonpb.KeyValue{kvStr("service.name", "worker")},
		[]*commonpb.KeyValue{
			kvStr(attrOrigin, "platform_internal"),
			kvStr(attrOrigin, "platform_internal"),
		},
	)

	td := forward(t, wire)

	spans := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans()
	for i := 0; i < spans.Len(); i++ {
		if v, ok := spans.At(i).Attributes().Get(attrOrigin); ok {
			t.Fatalf("a worker-forged span-level %s survived onto the customer forward: %q", attrOrigin, v.AsString())
		}
	}
}

func TestReparent_ReservedKeysCannotBeSmuggledByRepetition(t *testing.T) {
	wire := wirePayload(t, []*commonpb.KeyValue{
		kvStr(attrThreadID, "attacker-thread"),
		kvStr("service.name", "worker"),
		kvStr(attrThreadID, "attacker-thread"),
	}, nil)

	td := forward(t, wire)

	if got := countResourceAttr(td, attrThreadID); got != 1 {
		t.Fatalf("expected exactly one %s after the stamp, found %d", attrThreadID, got)
	}
	v, ok := td.ResourceSpans().At(0).Resource().Attributes().Get(attrThreadID)
	if !ok || v.AsString() != "conv-1" {
		t.Fatalf("worker value survived for %s: got %q", attrThreadID, v.AsString())
	}
}

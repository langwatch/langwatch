package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/baggage"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	sdktest "go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/otelsetup"
)

// applyInboundCausality should:
//  1. Read X-LangWatch-Causality-Depth header
//  2. Set baggage `langwatch.reserved.causality_depth = inbound + 1`
//  3. Extract W3C trace context from `traceparent` so subsequent
//     tracer.Start sees it as the parent
func TestApplyInboundCausality_HeaderToBaggage_DepthPlusOne(t *testing.T) {
	otelapi.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.Header.Set(CausalityDepthHeader, "3")

	ctx := applyInboundCausality(context.Background(), r)

	got := CurrentCausalityDepth(ctx)
	if got != 4 {
		t.Fatalf("CurrentCausalityDepth = %d, want 4 (3 + 1)", got)
	}
}

// Header gate: missing header → no baggage stamp at all. This is what
// prevents non-evaluator workflow runs (playground, scenarios, customer
// workflow runs) from polluting their spans with causality_depth and
// silently tripping the TS reactor's depth_direct guard.
func TestApplyInboundCausality_MissingHeader_NoStamp(t *testing.T) {
	otelapi.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	r := httptest.NewRequest(http.MethodPost, "/", nil)

	ctx := applyInboundCausality(context.Background(), r)

	got := CurrentCausalityDepth(ctx)
	if got != 0 {
		t.Fatalf("CurrentCausalityDepth = %d, want 0 (missing header must NOT stamp)", got)
	}
}

func TestApplyInboundCausality_NegativeHeader_TreatedAsZero(t *testing.T) {
	otelapi.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.Header.Set(CausalityDepthHeader, "-5")

	ctx := applyInboundCausality(context.Background(), r)

	got := CurrentCausalityDepth(ctx)
	if got != 1 {
		t.Fatalf("CurrentCausalityDepth = %d, want 1 (negative coerced to 0 + 1)", got)
	}
}

// Header present but value is "0" still stamps depth=1 so the eval
// chain root span carries the attribute. Distinguishes "depth=0 from
// caller" (still in eval chain) from "no header" (not in eval chain).
func TestApplyInboundCausality_HeaderZero_StampsOne(t *testing.T) {
	otelapi.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.Header.Set(CausalityDepthHeader, "0")

	ctx := applyInboundCausality(context.Background(), r)

	got := CurrentCausalityDepth(ctx)
	if got != 1 {
		t.Fatalf("CurrentCausalityDepth = %d, want 1 (header=0 → 0+1)", got)
	}
}

func TestApplyInboundCausality_ExtractsTraceparent(t *testing.T) {
	otelapi.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	traceID := "0af7651916cd43dd8448eb211c80319c"
	spanID := "b7ad6b7169203331"
	r.Header.Set("traceparent", "00-"+traceID+"-"+spanID+"-01")

	ctx := applyInboundCausality(context.Background(), r)

	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() {
		t.Fatalf("expected valid span context, got invalid (traceparent extract failed)")
	}
	if sc.TraceID().String() != traceID {
		t.Errorf("traceID = %s, want %s", sc.TraceID().String(), traceID)
	}
	if sc.SpanID().String() != spanID {
		t.Errorf("spanID = %s, want %s", sc.SpanID().String(), spanID)
	}
}

// The BaggageAttributeProcessor must stamp every span at OnStart with
// the causality_depth attribute pulled from baggage. This is the
// primary guarantee that ALL spans (root, child, grandchild) emitted
// during an evaluator run carry the attribute, not only the root.
func TestBaggageAttributeProcessor_StampsRootAndChildSpans(t *testing.T) {
	otelapi.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	recorder := sdktest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(otelsetup.NewBaggageAttributeProcessor(
			otelsetup.BaggageKeyCausalityDepth,
		)),
		sdktrace.WithSpanProcessor(recorder),
	)
	tracer := tp.Tracer("test")

	// Set depth=2 on context baggage so root + child should both carry it.
	bag, err := baggage.New()
	if err != nil {
		t.Fatalf("baggage.New: %v", err)
	}
	m, err := baggage.NewMember(otelsetup.BaggageKeyCausalityDepth, "2")
	if err != nil {
		t.Fatalf("baggage.NewMember: %v", err)
	}
	bag, err = bag.SetMember(m)
	if err != nil {
		t.Fatalf("bag.SetMember: %v", err)
	}
	ctx := baggage.ContextWithBaggage(context.Background(), bag)

	rootCtx, rootSpan := tracer.Start(ctx, "root")
	_, childSpan := tracer.Start(rootCtx, "child")
	_, grandchildSpan := tracer.Start(rootCtx, "grandchild")
	grandchildSpan.End()
	childSpan.End()
	rootSpan.End()

	if err := tp.ForceFlush(context.Background()); err != nil {
		t.Fatalf("ForceFlush: %v", err)
	}
	ended := recorder.Ended()
	if len(ended) != 3 {
		t.Fatalf("got %d ended spans, want 3", len(ended))
	}

	for _, span := range ended {
		var found bool
		for _, attr := range span.Attributes() {
			if string(attr.Key) == otelsetup.BaggageKeyCausalityDepth {
				if attr.Value.AsString() != "2" {
					t.Errorf("span %q: causality_depth = %s, want 2", span.Name(), attr.Value.AsString())
				}
				found = true
				break
			}
		}
		if !found {
			t.Errorf("span %q is missing causality_depth attribute (BaggageAttributeProcessor did not stamp)", span.Name())
		}
	}
}

// When no baggage is set on context, the processor must NOT stamp any
// attribute (silently skip), so unrelated spans aren't polluted.
func TestBaggageAttributeProcessor_NoBaggage_NoStamp(t *testing.T) {
	recorder := sdktest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(otelsetup.NewBaggageAttributeProcessor(
			otelsetup.BaggageKeyCausalityDepth,
		)),
		sdktrace.WithSpanProcessor(recorder),
	)
	tracer := tp.Tracer("test")

	_, span := tracer.Start(context.Background(), "no-baggage")
	span.End()

	if err := tp.ForceFlush(context.Background()); err != nil {
		t.Fatalf("ForceFlush: %v", err)
	}
	ended := recorder.Ended()
	if len(ended) != 1 {
		t.Fatalf("got %d spans, want 1", len(ended))
	}
	for _, attr := range ended[0].Attributes() {
		if string(attr.Key) == otelsetup.BaggageKeyCausalityDepth {
			t.Errorf("span carries causality_depth=%v despite no baggage on ctx", attr.Value.AsString())
		}
	}
}

// CurrentCausalityDepth defaults to 0 when no baggage is present.
func TestCurrentCausalityDepth_Default(t *testing.T) {
	if got := CurrentCausalityDepth(context.Background()); got != 0 {
		t.Errorf("CurrentCausalityDepth = %d, want 0", got)
	}
}

// CurrentCausalityDepth correctly reads numeric string values from baggage.
func TestCurrentCausalityDepth_ReadsBaggage(t *testing.T) {
	bag, _ := baggage.New()
	m, _ := baggage.NewMember(otelsetup.BaggageKeyCausalityDepth, "7")
	bag, _ = bag.SetMember(m)
	ctx := baggage.ContextWithBaggage(context.Background(), bag)

	if got := CurrentCausalityDepth(ctx); got != 7 {
		t.Errorf("CurrentCausalityDepth = %d, want 7", got)
	}
}

// Sanity: the header name + baggage key constants are the contract the TS
// dispatcher relies on. If anyone renames either, the integration breaks
// silently. Pin them in a test so a rename forces a conversation.
func TestCausalityWireContract_Pinned(t *testing.T) {
	if CausalityDepthHeader != "X-LangWatch-Causality-Depth" {
		t.Errorf("header = %q, want X-LangWatch-Causality-Depth", CausalityDepthHeader)
	}
	if otelsetup.BaggageKeyCausalityDepth != "langwatch.reserved.causality_depth" {
		t.Errorf("baggage key = %q, want langwatch.reserved.causality_depth", otelsetup.BaggageKeyCausalityDepth)
	}
}

// Unused import guard for Go's strict imports — strconv is used in
// other tests in this package but referenced here for parity if we add
// numeric assertions in future PRs.
var _ = strconv.Itoa

// Trick to satisfy the http import in case future cases need it.
var _ = http.MethodPost

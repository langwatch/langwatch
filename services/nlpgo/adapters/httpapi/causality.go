package httpapi

import (
	"context"
	"net/http"
	"strconv"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/baggage"
	"go.opentelemetry.io/otel/propagation"

	"github.com/langwatch/langwatch/pkg/otelsetup"
)

// causalityDepthHeader is the inbound header carrying the caller's current
// causality depth. nlpgo increments by 1 and stamps that value on every
// span it emits (via the BaggageAttributeProcessor registered in
// otelsetup). See specs/monitors/online-evaluator-loop-prevention.feature.
const causalityDepthHeader = "X-LangWatch-Causality-Depth"

// applyInboundCausality extracts the W3C trace context and causality
// depth from request headers, increments depth, and returns a context
// carrying:
//   - the extracted SpanContext (so tracer.Start uses the inbound trace
//     as parent — preserves trace_id end-to-end)
//   - baggage `langwatch.causality_depth = inbound + 1` (so every span
//     started from this context inherits it via the BaggageAttributeProcessor)
//
// Backward-compatible: callers that don't send these headers get
// inbound=0 → outbound depth=1 on the root span and downstream.
func applyInboundCausality(ctx context.Context, r *http.Request) context.Context {
	ctx = otelapi.GetTextMapPropagator().Extract(ctx, propagation.HeaderCarrier(r.Header))

	inbound := 0
	if raw := r.Header.Get(causalityDepthHeader); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v >= 0 {
			inbound = v
		}
	}

	bag := baggage.FromContext(ctx)
	member, err := baggage.NewMember(otelsetup.BaggageKeyCausalityDepth, strconv.Itoa(inbound+1))
	if err != nil {
		return ctx
	}
	bag, err = bag.SetMember(member)
	if err != nil {
		return ctx
	}
	return baggage.ContextWithBaggage(ctx, bag)
}

// CurrentCausalityDepth reads the depth from baggage on ctx. Returns 0
// when absent. Used by outbound HTTP callers (evaluator block) that
// need to forward the header to downstream services.
func CurrentCausalityDepth(ctx context.Context) int {
	bag := baggage.FromContext(ctx)
	m := bag.Member(otelsetup.BaggageKeyCausalityDepth)
	if m.Key() == "" {
		return 0
	}
	v, err := strconv.Atoi(m.Value())
	if err != nil || v < 0 {
		return 0
	}
	return v
}

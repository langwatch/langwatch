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
//   - baggage `langwatch.causality_depth = inbound + 1` ONLY when the
//     inbound header was present (i.e. this request is part of an
//     evaluator chain)
//
// The header gate is load-bearing. Without it, EVERY nlpgo request —
// playground runs, workflow runs, scenarios — would stamp depth>=1 on
// emitted spans and the reactor's per-span depth_direct guard would
// silently block ON_MESSAGE monitors on legitimate non-evaluator
// workflow runs. The TS dispatcher always sends the header on the
// evaluator path (nlpgoFetch.ts) so eval-chain detection stays intact.
func applyInboundCausality(ctx context.Context, r *http.Request) context.Context {
	ctx = otelapi.GetTextMapPropagator().Extract(ctx, propagation.HeaderCarrier(r.Header))

	raw := r.Header.Get(causalityDepthHeader)
	if raw == "" {
		// No caller depth → not part of an evaluator chain. Preserve
		// trace context extraction but do NOT stamp depth baggage.
		return ctx
	}

	inbound := 0
	if v, err := strconv.Atoi(raw); err == nil && v >= 0 {
		inbound = v
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

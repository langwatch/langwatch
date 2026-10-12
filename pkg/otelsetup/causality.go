package otelsetup

import (
	"context"
	"strconv"

	"go.opentelemetry.io/otel/baggage"
)

// CausalityDepthHeader carries the caller's causality depth on HTTP calls,
// beside the BaggageKeyCausalityDepth baggage member.
// See specs/monitors/online-evaluator-loop-prevention.feature.
const CausalityDepthHeader = "X-LangWatch-Causality-Depth"

// CausalityDepth reads the depth from baggage on ctx; 0 when absent or invalid.
func CausalityDepth(ctx context.Context) int {
	m := baggage.FromContext(ctx).Member(BaggageKeyCausalityDepth)
	if m.Key() == "" {
		return 0
	}
	v, err := strconv.Atoi(m.Value())
	if err != nil || v < 0 {
		return 0
	}
	return v
}

package langwatch

// SpanMetrics holds the per-span LLM cost rollup recorded under the
// langwatch.metrics attribute.
//
// Fields use pointers so that "unset" (nil) is distinct from a real zero, and
// they are emitted with the canonical snake_case names the trace-processing
// pipeline reads (the same shape the Python SDK exports). Cost feeds
// langwatch.span.cost; TokensEstimated flags whether the token counts (emitted
// separately as gen_ai.usage.* — see GenAIUsage) were estimated rather than
// reported by the provider.
type SpanMetrics struct {
	TokensEstimated *bool    `json:"tokens_estimated,omitempty"`
	Cost            *float64 `json:"cost,omitempty"`
}

// Int returns a pointer to v, for populating *int fields (e.g. GenAIUsage) inline.
func Int(v int) *int { return &v }

// Float64 returns a pointer to v, for populating SpanMetrics.Cost inline.
func Float64(v float64) *float64 { return &v }

// Bool returns a pointer to v, for populating SpanMetrics.TokensEstimated inline.
func Bool(v bool) *bool { return &v }

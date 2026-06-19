package langwatch

// SpanMetrics holds the per-span LLM cost and token metrics recorded under the
// langwatch.metrics attribute.
//
// Fields use pointers so that "unset" (nil) is distinct from a real zero, and
// they are emitted with the canonical snake_case names the trace-processing
// pipeline reads (the same shape the Python SDK exports). Token counts feed the
// gen_ai.usage.* totals; Cost feeds langwatch.span.cost.
type SpanMetrics struct {
	PromptTokens             *int     `json:"prompt_tokens,omitempty"`
	CompletionTokens         *int     `json:"completion_tokens,omitempty"`
	ReasoningTokens          *int     `json:"reasoning_tokens,omitempty"`
	CacheReadInputTokens     *int     `json:"cache_read_input_tokens,omitempty"`
	CacheCreationInputTokens *int     `json:"cache_creation_input_tokens,omitempty"`
	TokensEstimated          *bool    `json:"tokens_estimated,omitempty"`
	Cost                     *float64 `json:"cost,omitempty"`
}

// Int returns a pointer to v, for populating the *int metric fields inline.
func Int(v int) *int { return &v }

// Float64 returns a pointer to v, for populating SpanMetrics.Cost inline.
func Float64(v float64) *float64 { return &v }

// Bool returns a pointer to v, for populating SpanMetrics.TokensEstimated inline.
func Bool(v bool) *bool { return &v }

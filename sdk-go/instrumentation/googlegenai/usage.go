package googlegenai

import (
	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// usageMetadata is the Gemini usageMetadata block. All token kinds the unified
// genai API reports are read: promptTokenCount / candidatesTokenCount /
// totalTokenCount plus the cached-content and "thoughts" (reasoning) details.
type usageMetadata struct {
	PromptTokenCount        int `json:"promptTokenCount"`
	CandidatesTokenCount    int `json:"candidatesTokenCount"`
	TotalTokenCount         int `json:"totalTokenCount"`
	CachedContentTokenCount int `json:"cachedContentTokenCount"`
	ThoughtsTokenCount      int `json:"thoughtsTokenCount"`
}

// toGenAIUsage maps a Gemini usageMetadata block onto the LangWatch GenAIUsage
// helper, leaving fields nil (unrecorded) when the wire value is absent / zero.
//
//	promptTokenCount        -> InputTokens
//	candidatesTokenCount    -> OutputTokens
//	totalTokenCount         -> TotalTokens
//	cachedContentTokenCount -> CachedInputTokens
//	thoughtsTokenCount      -> ReasoningTokens
func (u *usageMetadata) toGenAIUsage() langwatch.GenAIUsage {
	usage := langwatch.GenAIUsage{}
	if u == nil {
		return usage
	}
	if u.PromptTokenCount > 0 {
		usage.InputTokens = langwatch.Int(u.PromptTokenCount)
	}
	if u.CandidatesTokenCount > 0 {
		usage.OutputTokens = langwatch.Int(u.CandidatesTokenCount)
	}
	if u.TotalTokenCount > 0 {
		usage.TotalTokens = langwatch.Int(u.TotalTokenCount)
	}
	if u.CachedContentTokenCount > 0 {
		usage.CachedInputTokens = langwatch.Int(u.CachedContentTokenCount)
	}
	if u.ThoughtsTokenCount > 0 {
		usage.ReasoningTokens = langwatch.Int(u.ThoughtsTokenCount)
	}
	return usage
}

// recordUsage records a usageMetadata block as BOTH gen_ai.usage.* attributes
// (via SetGenAIUsage) and the langwatch.metrics token rollup (via SetMetrics),
// so the span feeds both the OTel-native usage view and LangWatch cost/metric
// rollups.
func recordUsage(span *langwatch.Span, u *usageMetadata) {
	if u == nil {
		return
	}
	usage := u.toGenAIUsage()
	span.SetGenAIUsage(usage)
	span.SetMetrics(usageMetrics(usage))
}

// usageMetrics projects a GenAIUsage onto the LangWatch SpanMetrics token
// fields. CachedInputTokens maps to CacheReadInputTokens, the canonical
// LangWatch cache-read field.
func usageMetrics(u langwatch.GenAIUsage) langwatch.SpanMetrics {
	metrics := langwatch.SpanMetrics{}
	if u.InputTokens != nil {
		metrics.PromptTokens = langwatch.Int(*u.InputTokens)
	}
	if u.OutputTokens != nil {
		metrics.CompletionTokens = langwatch.Int(*u.OutputTokens)
	}
	if u.ReasoningTokens != nil {
		metrics.ReasoningTokens = langwatch.Int(*u.ReasoningTokens)
	}
	if u.CachedInputTokens != nil {
		metrics.CacheReadInputTokens = langwatch.Int(*u.CachedInputTokens)
	}
	return metrics
}

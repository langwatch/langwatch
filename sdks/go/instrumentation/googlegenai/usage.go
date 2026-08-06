package googlegenai

import (
	langwatch "github.com/langwatch/langwatch/sdks/go"
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
//	promptTokenCount - cachedContentTokenCount -> InputTokens
//	candidatesTokenCount                       -> OutputTokens
//	totalTokenCount                            -> TotalTokens
//	cachedContentTokenCount                    -> CachedInputTokens
//	thoughtsTokenCount                         -> ReasoningTokens
//
// InputTokens carries the NON-CACHED input only. Gemini reports
// cachedContentTokenCount as a subset of promptTokenCount, whereas LangWatch
// costs the buckets additively (input at the input rate plus cache-read at the
// cache-read rate), so the cached portion is subtracted out here. That yields
// the same exclusive split Anthropic and Bedrock report natively, keeping the
// convention uniform across instrumentations. Reporting promptTokenCount as-is
// would bill the cached tokens twice. TotalTokens is left as the provider's
// reported total.
func (u *usageMetadata) toGenAIUsage() langwatch.GenAIUsage {
	usage := langwatch.GenAIUsage{}
	if u == nil {
		return usage
	}
	// Clamped at zero: a provider reporting cached > prompt is bad data, and the
	// field stays nil rather than going negative.
	if nonCached := u.PromptTokenCount - u.CachedContentTokenCount; nonCached > 0 {
		usage.InputTokens = langwatch.Int(nonCached)
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

// recordUsage records a usageMetadata block as gen_ai.usage.* attributes (via
// SetGenAIUsage), the sole token source feeding the OTel-native usage view.
func recordUsage(span *langwatch.Span, u *usageMetadata) {
	if u == nil {
		return
	}
	span.SetGenAIUsage(u.toGenAIUsage())
}

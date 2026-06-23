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

// recordUsage records a usageMetadata block as gen_ai.usage.* attributes (via
// SetGenAIUsage), the sole token source feeding the OTel-native usage view.
func recordUsage(span *langwatch.Span, u *usageMetadata) {
	if u == nil {
		return
	}
	span.SetGenAIUsage(u.toGenAIUsage())
}

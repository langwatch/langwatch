package gopenai

import (
	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// usagePayload is the OpenAI usage block, covering the chat, legacy-completions
// and embeddings shapes. All five token kinds are read: prompt/completion/total
// plus the cached-input and reasoning details OpenAI nests under
// prompt_tokens_details / completion_tokens_details.
type usagePayload struct {
	PromptTokens        int `json:"prompt_tokens"`
	CompletionTokens    int `json:"completion_tokens"`
	TotalTokens         int `json:"total_tokens"`
	PromptTokensDetails struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
	CompletionTokensDetails struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"completion_tokens_details"`
}

// toGenAIUsage maps an OpenAI usage block onto the LangWatch GenAIUsage helper,
// leaving fields nil (unrecorded) when the wire value is absent / zero.
func (u *usagePayload) toGenAIUsage() langwatch.GenAIUsage {
	usage := langwatch.GenAIUsage{}
	if u == nil {
		return usage
	}
	if u.PromptTokens > 0 {
		usage.InputTokens = langwatch.Int(u.PromptTokens)
	}
	if u.CompletionTokens > 0 {
		usage.OutputTokens = langwatch.Int(u.CompletionTokens)
	}
	if u.TotalTokens > 0 {
		usage.TotalTokens = langwatch.Int(u.TotalTokens)
	}
	if u.PromptTokensDetails.CachedTokens > 0 {
		usage.CachedInputTokens = langwatch.Int(u.PromptTokensDetails.CachedTokens)
	}
	if u.CompletionTokensDetails.ReasoningTokens > 0 {
		usage.ReasoningTokens = langwatch.Int(u.CompletionTokensDetails.ReasoningTokens)
	}
	return usage
}

// recordUsage records a usage block as BOTH gen_ai.usage.* attributes (via
// SetGenAIUsage) and the langwatch.metrics token rollup (via SetMetrics), so the
// span feeds both the OTel-native usage view and LangWatch cost/metric rollups.
func recordUsage(span *langwatch.Span, u *usagePayload) {
	usage := u.toGenAIUsage()
	span.SetGenAIUsage(usage)
	span.SetMetrics(usageMetrics(usage))
}

// usageMetrics projects a GenAIUsage onto the LangWatch SpanMetrics token
// fields. cached_input_tokens maps to cache_read_input_tokens, the canonical
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

// mergeUsage folds a streamed usage chunk into an accumulating GenAIUsage,
// overwriting each field when the chunk carries a non-zero value.
func mergeUsage(dst *langwatch.GenAIUsage, u *usagePayload) {
	src := u.toGenAIUsage()
	if src.InputTokens != nil {
		dst.InputTokens = src.InputTokens
	}
	if src.OutputTokens != nil {
		dst.OutputTokens = src.OutputTokens
	}
	if src.TotalTokens != nil {
		dst.TotalTokens = src.TotalTokens
	}
	if src.CachedInputTokens != nil {
		dst.CachedInputTokens = src.CachedInputTokens
	}
	if src.ReasoningTokens != nil {
		dst.ReasoningTokens = src.ReasoningTokens
	}
}

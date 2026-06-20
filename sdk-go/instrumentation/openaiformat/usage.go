package openaiformat

import (
	"encoding/json"

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

// recordUsage records a usage block as gen_ai.usage.* attributes (via
// SetGenAIUsage), the sole token source feeding the OTel-native usage view.
func recordUsage(span *langwatch.Span, u *usagePayload) {
	span.SetGenAIUsage(u.toGenAIUsage())
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

// dedupe returns the unique values of in, preserving first-seen order. It is
// used to collapse repeated streamed finish reasons.
func dedupe(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

// stopSequences flattens the OpenAI stop union (string or []string) into a slice.
func stopSequences(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var single string
	if err := json.Unmarshal(raw, &single); err == nil {
		if single == "" {
			return nil
		}
		return []string{single}
	}
	var many []string
	if err := json.Unmarshal(raw, &many); err == nil {
		return many
	}
	return nil
}

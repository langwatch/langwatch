// Package litellm translates the legacy `litellm_params` shape produced by
// the LangWatch app into the wire format the AI Gateway accepts. It also
// owns model-id rewrites (dot→dash, alias expansion, custom→openai prefix
// at the gateway boundary) and reasoning-model behavior overrides.
//
// See specs/nlp-go/_shared/contract.md §9 and ash-domain-map.md.
package litellm

import (
	"regexp"
	"strings"
)

// Anthropic alias expansions, mirrored from langwatch/src/server/modelProviders/modelIdBoundary.ts.
// These MUST stay in sync with the TS source — the migration spec freezes the
// model id semantics for v1, so any new alias added on the TS side must be
// added here too. (The TS file has a deliberate "duplicated in Python" note
// pointing to langwatch_nlp/studio/utils.py; this Go module is the third
// echo and the TS file is the source of truth.)
var modelAliases = map[string]string{
	"anthropic/claude-sonnet-4":    "anthropic/claude-sonnet-4-20250514",
	"anthropic/claude-opus-4":      "anthropic/claude-opus-4-20250514",
	"anthropic/claude-3.5-haiku":   "anthropic/claude-3-5-haiku-20241022",
	"anthropic/claude-3.5-sonnet":  "anthropic/claude-3-5-sonnet-20240620",
}

// providersNeedingDotToDash is the allowlist for the dot→dash rewrite. Only
// these providers get their model ids transformed — applying it to OpenAI's
// `gpt-3.5-turbo` would break that model name.
var providersNeedingDotToDash = map[string]bool{
	"anthropic": true,
	"custom":    true,
}

// reasoningModelPattern catches the reasoning-class models that pin
// temperature to 1.0 and require a higher max_tokens floor. Mirrors the
// behavior preserved from langwatch_nlp/studio/utils.py.
var reasoningModelPattern = regexp.MustCompile(`(?i)\b(o1|o3|o4|o5|gpt-5)`)

// reasoningMaxTokensFloor is the minimum max_tokens we will send to the
// gateway for a reasoning model. Lower values commonly produce truncated
// completions when the model spends the budget on reasoning tokens.
const reasoningMaxTokensFloor = 16000

// SplitProviderModel splits "vertex_ai/gemini-2.0-flash" into ("vertex_ai",
// "gemini-2.0-flash"). A model id without a slash is returned with an empty
// provider — callers should treat that as "use the model id as-is".
func SplitProviderModel(modelID string) (provider, model string) {
	idx := strings.IndexByte(modelID, '/')
	if idx < 0 {
		return "", modelID
	}
	return strings.ToLower(modelID[:idx]), modelID[idx+1:]
}

// TranslateModelID applies the boundary rewrites that the TS LangWatch app
// applies before sending to LiteLLM. The Go path now sends to the gateway
// directly, but customer workflows are populated with these expectations
// baked in, so the rewrite has to happen here.
//
// Order matters: alias expansion is checked first so we replace before the
// dot→dash pass strips the dot we want to match against.
func TranslateModelID(modelID string) string {
	if modelID == "" {
		return modelID
	}
	if expanded, ok := modelAliases[modelID]; ok {
		return expanded
	}
	provider, _ := SplitProviderModel(modelID)
	// An empty-provider id (e.g. bare "claude-3.5-sonnet") gets treated as
	// possibly anthropic. The TS source applies dot→dash in that case for
	// safety; mirror it.
	if provider != "" && !providersNeedingDotToDash[provider] {
		return modelID
	}
	return strings.ReplaceAll(modelID, ".", "-")
}

// GatewayProviderForModel returns the provider id the AI Gateway should
// dispatch on. Custom models flip to "openai" at the gateway boundary
// because they're treated as OpenAI-compatible (the customer's api_base
// gets carried in the inline credentials).
func GatewayProviderForModel(provider string) string {
	if provider == "custom" {
		return "openai"
	}
	return provider
}

// IsReasoningModel reports whether the model id matches the reasoning class
// (o1/o3/o4/o5/gpt-5*).
func IsReasoningModel(modelID string) bool {
	return reasoningModelPattern.MatchString(modelID)
}

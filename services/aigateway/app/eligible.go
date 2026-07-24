package app

import (
	"strings"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// eligibleCredentials returns the subset of `creds` that can serve the
// resolved model, preserving caller-supplied order so the existing
// fallback semantics survive intact.
//
// Why this exists: before model-aware routing, the dispatcher walked
// the entire fallback chain in order and trusted Bifrost to fail-fast
// on incompatible provider/model combos. With personal VKs that grant
// access to many providers (Anthropic + OpenAI + Gemini behind one
// key), an implicit "claude-3-5-sonnet" request would attempt
// OpenAI/Gemini first if they preceded Anthropic in the chain — every
// such attempt being a wasted RTT + fallback log entry. This helper
// trims the chain to providers that can actually serve the request.
//
// Filtering rules:
//
//  1. Resolved.ProviderID set (explicit prefix or alias-resolved): keep
//     only credentials whose ProviderID matches.
//  2. Resolved.ProviderID empty (implicit model name): infer the
//     provider from the model name prefix and keep matching creds. If
//     no provider knows the prefix, leave the chain untouched (fall
//     back to existing behavior).
//
// Safety net: if the filter empties the chain entirely, return the
// original creds. We never want this helper to convert "the user has
// a usable provider somewhere" into a hard-fail; a wrong-provider
// dispatch surfaces a clear error from Bifrost, but no-providers
// surfaces an opaque internal error to the caller.
func eligibleCredentials(creds []domain.Credential, resolved *domain.ResolvedModel) []domain.Credential {
	if len(creds) == 0 || resolved == nil {
		return creds
	}

	target := resolved.ProviderID
	if target == "" {
		target = inferProviderFromModel(resolved.ModelID)
	}
	if target == "" {
		return creds
	}

	out := make([]domain.Credential, 0, len(creds))
	for _, c := range creds {
		if c.ProviderID == target {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		return creds
	}
	return out
}

// inferProviderFromModel maps a bare model name to the provider that
// originated it. Bedrock/Vertex are intentionally NOT in this table:
// when a user asks for "claude-3-5-sonnet" implicitly, the friendly
// answer is "use Anthropic's native API"; if they want Bedrock they
// can write "bedrock/anthropic.claude-…" or alias it.
//
// This is a curated short list — keeping a comprehensive model
// catalog in sync with reality is the model resolver's job (and
// Bifrost's), not a routing helper. Each prefix returned must
// correspond to a domain.ProviderID constant declared in
// services/aigateway/domain/provider.go.
func inferProviderFromModel(model string) domain.ProviderID {
	m := strings.ToLower(model)
	switch {
	case strings.HasPrefix(m, "claude-"):
		return domain.ProviderAnthropic
	case strings.HasPrefix(m, "gpt-"),
		strings.HasPrefix(m, "o1-"),
		strings.HasPrefix(m, "o3-"),
		strings.HasPrefix(m, "o4-"),
		strings.HasPrefix(m, "chatgpt-"),
		strings.HasPrefix(m, "text-embedding-"),
		strings.HasPrefix(m, "dall-e-"),
		strings.HasPrefix(m, "whisper-"),
		strings.HasPrefix(m, "tts-"):
		return domain.ProviderOpenAI
	case strings.HasPrefix(m, "gemini-"):
		return domain.ProviderGemini
	}
	return ""
}

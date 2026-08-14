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
//     only credentials whose ProviderID matches. Nothing matching is
//     reported through `unreachable` rather than dispatched elsewhere:
//     the caller, or the policy alias they hit, named this provider, and
//     serving the request from another vendor answers a question nobody
//     asked. It also reads as a governance hole on a key whose whole
//     purpose is to bound which providers it can reach.
//  2. Resolved.ProviderID empty (implicit model name): infer the
//     provider from the model name prefix and keep matching creds. If no
//     provider knows the prefix, or the inference matches nothing the key
//     holds, leave the chain untouched. The inference is a guess from a
//     short prefix table, and a guess must not refuse a request the key
//     could have served.
func eligibleCredentials(
	creds []domain.Credential,
	resolved *domain.ResolvedModel,
) (kept []domain.Credential, unreachable domain.ProviderID) {
	if len(creds) == 0 || resolved == nil {
		return creds, ""
	}

	named := resolved.ProviderID
	target := named
	if target == "" {
		target = inferProviderFromModel(resolved.ModelID)
	}
	if target == "" {
		return creds, ""
	}

	out := make([]domain.Credential, 0, len(creds))
	for _, c := range creds {
		if c.ProviderID == target {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		if named != "" {
			return nil, named
		}
		return creds, ""
	}
	return out, ""
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

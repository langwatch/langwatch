package app

import (
	"context"
	"fmt"
	"strings"

	"github.com/langwatch/langwatch/pkg/herr"
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
// Safety net (implicit names only): if inferring a provider from a bare
// model name empties the chain, return the original creds — a bare model
// name carries no provider prefix, so each attempt dispatches with the
// credential's own provider and fails with that provider's real error.
//
// Explicitly-named providers (a "provider/model" prefix or an alias) get
// the opposite treatment: an empty filter is a hard fail with
// ErrProviderNotBound. Dispatching anyway would forward the prefixed
// model string with a mismatched credential, and Bifrost's model-prefix
// provider override then reads that credential through the wrong
// provider's key-config shape — surfacing as opaque errors like
// "deployments not set" (Azure), "no keys found that support model"
// (Gemini), or raw HTML error pages (Vertex) instead of telling the
// caller the provider isn't configured.
func eligibleCredentials(ctx context.Context, creds []domain.Credential, resolved *domain.ResolvedModel) ([]domain.Credential, error) {
	if len(creds) == 0 || resolved == nil {
		return creds, nil
	}

	target := resolved.ProviderID
	explicit := target != ""
	if target == "" {
		target = inferProviderFromModel(resolved.ModelID)
	}
	if target == "" {
		return creds, nil
	}

	out := make([]domain.Credential, 0, len(creds))
	for _, c := range creds {
		if c.ProviderID == target {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		if explicit {
			return nil, herr.New(ctx, domain.ErrProviderNotBound, herr.M{
				"message": fmt.Sprintf("no %q provider is configured for this key", target),
				"hint":    fmt.Sprintf("bind a %q provider slot to this virtual key, or drop the %q model prefix", target, target),
			})
		}
		return creds, nil
	}
	return out, nil
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

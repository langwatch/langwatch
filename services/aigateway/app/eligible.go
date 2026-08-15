package app

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// routableChain trims the credential chain to the credentials that could
// actually serve this request: first to the providers the inbound route
// speaks, then to the providers the resolved model names.
func routableChain(ctx context.Context, req *domain.Request, creds []domain.Credential) ([]domain.Credential, error) {
	creds, err := surfaceCredentials(ctx, creds, req)
	if err != nil {
		return nil, err
	}
	return eligibleCredentials(ctx, creds, req.Resolved)
}

// surfaceCredentials keeps only the credentials whose provider speaks the
// wire of the route the request arrived on.
//
// A raw-forward route sends the caller's body and URL path to the vendor
// unchanged, so the route decides the vendor. Before this trim, the Gemini
// /v1beta surface let the credential chain decide instead: a key holding an
// OpenAI credential and no Google one sent a Gemini-shaped body to OpenAI,
// which answered 404 for a model it never had. The 404 hides the real cost.
// The prompt had already left for a vendor the caller never named.
//
// Routes the gateway translates pin nothing and are untouched here. Under
// /v1 the body is rewritten per provider before it leaves, so any provider
// can serve the request and eligibleCredentials makes the choice.
func surfaceCredentials(ctx context.Context, creds []domain.Credential, req *domain.Request) ([]domain.Credential, error) {
	surface := req.InboundSurface()
	if len(creds) == 0 || len(surface.Providers) == 0 {
		return creds, nil
	}

	out := make([]domain.Credential, 0, len(creds))
	for _, c := range creds {
		if slices.Contains(surface.Providers, c.ProviderID) {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		names := providerNames(surface.Providers)
		return nil, herr.New(ctx, domain.ErrProviderNotBound, herr.M{
			"message": fmt.Sprintf("%s sends the request to the provider unchanged, so only %s can serve it, and this key has none of them",
				surface.Name, names),
			"hint": fmt.Sprintf("bind one of %s to this virtual key, or send the request to /v1/chat/completions, which the gateway translates for any provider",
				names),
			"fault": "customer",
		})
	}
	return out, nil
}

// providerNames renders a provider list for an error message, as
// `"gemini" or "vertex"`.
func providerNames(providers []domain.ProviderID) string {
	quoted := make([]string, len(providers))
	for i, p := range providers {
		quoted[i] = fmt.Sprintf("%q", string(p))
	}
	if len(quoted) < 2 {
		return strings.Join(quoted, "")
	}
	return strings.Join(quoted[:len(quoted)-1], ", ") + " or " + quoted[len(quoted)-1]
}

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

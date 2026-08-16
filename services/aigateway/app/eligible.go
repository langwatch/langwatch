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
// speaks (surface trim), then to the providers the resolved model names
// (model-aware trim).
//
// When the model-aware trim leaves an explicitly named provider with no
// credential, the failure names WHY, from what the control plane reported on
// the bundle: the routing policy dropped it, provider access dropped it, or it
// is not reachable from the key's scope. An empty chain gets the same reason: a
// bundle whose allowlist names only an excluded provider carries no dispatchable
// credential by design, and that is named rather than reported as an
// organization with no provider configured.
func routableChain(ctx context.Context, bundle *domain.Bundle, req *domain.Request) ([]domain.Credential, error) {
	creds, err := surfaceCredentials(ctx, bundle.Credentials, req)
	if err != nil {
		// A raw-forward surface with no credential left can be a routing-policy
		// or provider-access exclusion in disguise: the provider the route
		// speaks was dropped from dispatch, so none of its credentials remain.
		// Give that reason when the resolved provider is one the route speaks;
		// otherwise the surface's own not-reachable message stands.
		if reason := reasonForBlockedSurface(ctx, req, bundle.Config); reason != nil {
			return nil, reason
		}
		return nil, err
	}
	creds, err = eligibleCredentials(ctx, creds, req.Resolved)
	if err != nil {
		// eligibleCredentials refused an explicitly named provider that has no
		// credential (the not-reachable-from-scope reason). When the control
		// plane reported a routing-policy or provider-access exclusion for that
		// provider, that is the more specific reason to give.
		if reason := reasonForBlockedProvider(ctx, req.Resolved, bundle.Config); reason != nil {
			return nil, reason
		}
		return nil, err
	}
	// An empty chain with no error means the bundle carries no dispatchable
	// credential. That is a genuinely unconfigured organization, unless the key's
	// allowlist names only a provider the routing policy or provider access
	// dropped: then `providers[]` is empty by design and the reason is on the
	// bundle. Name it here, so candidateChain does not fall back to the generic
	// no_provider_configured for a request Phase 2 can explain.
	if len(creds) == 0 {
		if reason := reasonForEmptyChain(ctx, req, bundle.Config); reason != nil {
			return nil, reason
		}
	}
	return creds, nil
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
// the opposite treatment: an empty filter is a hard fail with the
// not-reachable-from-scope reason. `routableChain` upgrades that to the
// routing-policy or provider-access reason when the control plane reported
// one for the provider. Dispatching anyway would forward the prefixed model
// string with a mismatched credential, and Bifrost's model-prefix provider
// override then reads that credential through the wrong provider's key-config
// shape — surfacing as opaque errors like "deployments not set" (Azure), "no
// keys found that support model" (Gemini), or raw HTML error pages (Vertex).
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

	if out := credentialsForProvider(creds, target); len(out) > 0 {
		return out, nil
	}
	if explicit {
		return nil, providerNotReachable(ctx, target)
	}
	return creds, nil
}

// credentialsForProvider keeps the credentials that can serve the target
// provider kind, preserving order so fallback semantics survive.
func credentialsForProvider(creds []domain.Credential, target domain.ProviderID) []domain.Credential {
	out := make([]domain.Credential, 0, len(creds))
	for _, c := range creds {
		if c.ProviderID == target {
			out = append(out, c)
		}
	}
	return out
}

// reasonForEmptyChain names why an empty dispatch chain blocked the request, or
// nil when nothing the control plane reported explains it, so the caller keeps
// no_provider_configured for a genuinely unconfigured bundle. A raw-forward
// route is pinned to its surface, so it reads through the surface-guarded
// reason; a translated route reads the resolved provider directly.
func reasonForEmptyChain(ctx context.Context, req *domain.Request, cfg domain.BundleConfig) error {
	if len(req.InboundSurface().Providers) > 0 {
		return reasonForBlockedSurface(ctx, req, cfg)
	}
	return reasonForBlockedProvider(ctx, req.Resolved, cfg)
}

// reasonForBlockedProvider names the routing-policy or provider-access reason
// the control plane reported for the request's resolved provider, or nil when
// it reported neither (the caller then keeps the not-reachable-from-scope
// reason).
func reasonForBlockedProvider(ctx context.Context, resolved *domain.ResolvedModel, cfg domain.BundleConfig) error {
	if resolved == nil {
		return nil
	}
	target := resolved.ProviderID
	if target == "" {
		target = inferProviderFromModel(resolved.ModelID)
	}
	if target == "" {
		return nil
	}
	return blockedProviderError(ctx, target, cfg)
}

// reasonForBlockedSurface names the routing-policy or provider-access reason for
// a raw-forward route that has no credential left, when the resolved provider is
// one the route speaks and the control plane reported an exclusion for it. It
// returns nil otherwise, so the caller keeps the surface's not-reachable
// message. The surface-provider guard stops a mismatched resolved provider from
// borrowing another provider's reason.
func reasonForBlockedSurface(ctx context.Context, req *domain.Request, cfg domain.BundleConfig) error {
	if req == nil || req.Resolved == nil {
		return nil
	}
	target := req.Resolved.ProviderID
	if target == "" {
		target = inferProviderFromModel(req.Resolved.ModelID)
	}
	if target == "" {
		return nil
	}
	if !slices.Contains(req.InboundSurface().Providers, target) {
		return nil
	}
	return blockedProviderError(ctx, target, cfg)
}

// blockedProviderError names why the control plane dropped the resolved provider
// from the dispatch chain, or nil when nothing it reported excluded it.
func blockedProviderError(ctx context.Context, target domain.ProviderID, cfg domain.BundleConfig) error {
	switch cfg.BlockedProviderReason(target) {
	case domain.ProviderBlockRouting:
		return providerBlockedByRouting(ctx, target, cfg.RoutingPolicyName)
	case domain.ProviderBlockAccess:
		return providerBlockedByAccess(ctx, target)
	case domain.ProviderBlockNone:
		return nil
	}
	return nil
}

// providerBlockedByRouting is the block when the key's routing policy leaves the
// resolved provider out of the dispatch chain. Names the policy when known.
func providerBlockedByRouting(ctx context.Context, kind domain.ProviderID, policyName string) error {
	msg := fmt.Sprintf(
		"The %q provider is not available on this key: its routing policy does not include this provider. Ask the key's owner to add it to the routing policy, or send the request to a provider the policy allows.",
		kind,
	)
	if policyName != "" {
		msg = fmt.Sprintf(
			"The %q provider is not available on this key: its routing policy %q does not include this provider. Ask the key's owner to add it to the routing policy, or send the request to a provider the policy allows.",
			kind, policyName,
		)
	}
	return herr.New(ctx, domain.ErrModelNotAllowed, herr.M{
		"message": msg,
		"fault":   "customer",
	})
}

// providerBlockedByAccess is the block when the resolved provider is reachable
// from the key's scope but outside its provider access allowlist.
func providerBlockedByAccess(ctx context.Context, kind domain.ProviderID) error {
	return herr.New(ctx, domain.ErrModelNotAllowed, herr.M{
		"message": fmt.Sprintf(
			"The %q provider is not in this key's provider access. Ask the key's owner to add it to the key's allowed providers.",
			kind,
		),
		"fault": "customer",
	})
}

// providerNotReachable is the block when the resolved provider is not reachable
// from the key's scope at all, so no credential is configured for it.
func providerNotReachable(ctx context.Context, kind domain.ProviderID) error {
	return herr.New(ctx, domain.ErrProviderNotBound, herr.M{
		"message": fmt.Sprintf(
			"The %q provider is not reachable from this key's scope, so no credential is configured for it. Ask the key's owner to add the provider, or send the request to a configured provider.",
			kind,
		),
		"hint":  fmt.Sprintf("add a %q provider in this key's scope, or drop the %q model prefix", kind, kind),
		"fault": "customer",
	})
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

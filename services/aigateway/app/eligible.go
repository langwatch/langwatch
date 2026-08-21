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
	creds, err = eligibleCredentials(ctx, credentialChoice{
		creds:     creds,
		resolved:  req.Resolved,
		cfg:       bundle.Config,
		reachable: bundle.Credentials,
	})
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
func eligibleCredentials(ctx context.Context, choice credentialChoice) ([]domain.Credential, error) {
	if len(choice.creds) == 0 || choice.resolved == nil {
		return choice.creds, nil
	}
	if choice.resolved.CredentialID != "" {
		return choice.pinnedInstance(ctx)
	}
	if choice.resolved.ProviderID != "" {
		if out := credentialsForProvider(choice.creds, choice.resolved.ProviderID); len(out) > 0 {
			return out, nil
		}
		return nil, choice.notReachable(ctx)
	}
	return choice.forBareModel(ctx)
}

// credentialChoice is everything picking a credential needs: the chain the
// surface trim left, what the resolver read, and the key's config, which the
// refusals read to tell the caller what this key can reach.
type credentialChoice struct {
	creds    []domain.Credential
	resolved *domain.ResolvedModel
	cfg      domain.BundleConfig
	// reachable is the key's WHOLE credential chain, before the surface trim
	// narrowed it. The refusals list what the key can reach, and reading that
	// off the trimmed chain would name only the providers that survived the
	// trim, which is a different and smaller answer than the one the caller
	// needs.
	reachable []domain.Credential
}

// pinnedInstance answers a request that named a routing handle. A handle names
// ONE row, so it pins that row and nothing else. A handle whose row is not
// dispatchable falls through to the caller, which reports which of the key's
// settings removed it.
func (choice credentialChoice) pinnedInstance(ctx context.Context) ([]domain.Credential, error) {
	for _, c := range choice.creds {
		if c.ID == choice.resolved.CredentialID {
			return []domain.Credential{c}, nil
		}
	}
	// The refusal names the HANDLE, not the family. Only one instance is out
	// of reach here, and the family often is not: a surface trim can drop the
	// handled row while another row of the same family survives, and naming
	// the family then contradicts the list of prefixes the same message
	// offers. The handle is also the thing the caller actually wrote.
	if handle := choice.pinnedHandle(); handle != "" {
		return nil, instanceNotReachable(ctx, handle, choice.options())
	}
	return nil, choice.notReachable(ctx)
}

// pinnedHandle is the routing handle of the row the resolver pinned, read off
// the key's whole chain rather than the trimmed one, because the trim is what
// removed the row in the first place. Empty when the chain no longer holds it.
func (choice credentialChoice) pinnedHandle() string {
	for _, c := range choice.reachable {
		if c.ID == choice.resolved.CredentialID {
			return c.Handle
		}
	}
	return ""
}

// notReachable refuses a provider the caller named that this key cannot reach,
// naming what it can.
func (choice credentialChoice) notReachable(ctx context.Context) error {
	return providerNotReachable(ctx, choice.resolved.ProviderID, choice.options())
}

// options is the prefixes this key accepts.
func (choice credentialChoice) options() reachable {
	return reachableOptions(choice.reachable, choice.cfg)
}

// credentialsForBareModel picks the credentials that can serve a model name
// carrying no provider qualifier, in the order the answers get less certain.
//
//  1. The providers that DECLARE the model. A custom provider lists the models
//     it serves and a hosted family ships its catalog, so this is the provider
//     saying so itself. This is what makes a declared model routable without a
//     prefix, which is the whole point: GET /v1/models already listed those
//     names, and dispatch used to refuse them.
//  2. The vendor guessed from the model name ("gpt-" is OpenAI's). A short
//     curated table, kept as the safety net for a model newer than the shipped
//     catalog.
//  3. The providers that declared NOTHING. Silence is not a denial: a
//     self-hosted proxy or a Bedrock account that never listed its models
//     cannot be ruled out by a model it does not list, while a provider that
//     did list its models has already answered. This is also what keeps a
//     bare key with an empty catalog working.
//  4. A lone credential, whatever it declared. One door is not a choice
//     between vendors.
//
// Past that the model is refused, because the only thing left is sending it to
// several vendors that each said they do not serve it.
func (choice credentialChoice) forBareModel(ctx context.Context) ([]domain.Credential, error) {
	model := choice.resolved.ModelID
	if out := choice.narrowToBareModel(model); len(out) > 0 {
		return out, nil
	}
	return nil, modelNotRecognized(ctx, model, choice.options())
}

// narrowToBareModel applies the four steps in order and returns the first
// non-empty answer, or nothing when the model is unplaceable.
func (choice credentialChoice) narrowToBareModel(model string) []domain.Credential {
	if declaring := filterCredentials(choice.creds, func(c domain.Credential) bool {
		return c.ServesModel(model)
	}); len(declaring) > 0 {
		return declaring
	}
	if guessed := inferProviderFromModel(model); guessed != "" {
		if out := credentialsForProvider(choice.creds, guessed); len(out) > 0 {
			return out
		}
	}
	if undeclared := filterCredentials(choice.creds, func(c domain.Credential) bool {
		return !c.DeclaresCatalog()
	}); len(undeclared) > 0 {
		return undeclared
	}
	if len(choice.creds) == 1 {
		return choice.creds
	}
	return nil
}

// filterCredentials keeps the credentials matching keep, preserving order so
// fallback semantics survive.
func filterCredentials(creds []domain.Credential, keep func(domain.Credential) bool) []domain.Credential {
	var out []domain.Credential
	for _, c := range creds {
		if keep(c) {
			out = append(out, c)
		}
	}
	return out
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
	// A routing handle named ONE row, so the reason is that row's. Reading it
	// off the provider kind would let a key holding two Anthropic rows answer
	// for the surviving row when the caller named the dropped one.
	if resolved.CredentialID != "" {
		switch cfg.BlockedRowReason(resolved.CredentialID) {
		case domain.ProviderBlockRouting:
			return providerBlockedByRouting(ctx, resolved.ProviderID, cfg.RoutingPolicyName)
		case domain.ProviderBlockAccess:
			return providerBlockedByAccess(ctx, resolved.ProviderID)
		case domain.ProviderBlockNone:
			return nil
		}
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
//
// The message lists what this key CAN reach. An earlier version withheld the
// list to avoid disclosing tenant structure, which was the wrong trade: the
// caller is holding the virtual key, GET /v1/models on that same key already
// enumerates its models, and a refusal naming nothing left them with no way to
// find the spelling that works.
func providerNotReachable(ctx context.Context, kind domain.ProviderID, options reachable) error {
	return herr.New(ctx, domain.ErrProviderNotBound, herr.M{
		"message": fmt.Sprintf(
			"The %q provider is not reachable from this key's scope, so no credential is configured for it. This key reaches %s. Ask the key's owner to add the provider, or send the request to one of those.",
			kind, options.rendered,
		),
		"hint":  fmt.Sprintf("prefix the model with one of %s, or drop the %q prefix and name a model one of them serves", options.rendered, kind),
		"fault": "customer",
		// The list as data, so a client can compose its own copy from it
		// instead of re-displaying our sentence. Bounded the same way.
		"options": options.names,
	})
}

// instanceNotReachable refuses a routing handle whose provider row this
// request cannot reach, naming the handle rather than its family. The family
// may well be reachable through another row, so saying "anthropic is not
// reachable" while listing "anthropic" as an accepted prefix reads as two
// contradictory sentences in one message.
func instanceNotReachable(ctx context.Context, handle string, options reachable) error {
	return herr.New(ctx, domain.ErrProviderNotBound, herr.M{
		"message": fmt.Sprintf(
			"The provider with routing handle %q is not reachable from this request. This key reaches %s. Ask the key's owner to grant the provider, or send the request to one of those.",
			handle, options.rendered,
		),
		"hint":    fmt.Sprintf("prefix the model with one of %s instead of %q", options.rendered, handle),
		"fault":   "customer",
		"handle":  handle,
		"options": options.names,
	})
}

// modelNotRecognized is the block when a bare model name matches nothing the
// key can place and the key holds more than one provider that said what it
// serves.
func modelNotRecognized(ctx context.Context, model string, options reachable) error {
	return herr.New(ctx, domain.ErrModelNotRecognized, herr.M{
		"message": fmt.Sprintf(
			"No provider on this key serves the model %q. This key reaches %s. Name the provider in the model string, or declare the model on the provider that serves it.",
			model, options.rendered,
		),
		"hint":    fmt.Sprintf("send %q as \"<provider>/%s\" using one of %s, or add %q to that provider's models", model, model, options.rendered, model),
		"fault":   "customer",
		"model":   model,
		"options": options.names,
	})
}

// maxReachableOptions bounds how many spellings a refusal lists. A key can be
// bound to dozens of providers, and an error a caller has to scroll is an
// error they stop reading.
const maxReachableOptions = 10

// reachableOptions renders the prefixes this key accepts: the provider
// families its credentials belong to, plus the routing handles its providers
// carry. Rendered as a quoted, comma-separated list, capped, with the overflow
// stated rather than silently dropped.
// reachable is the prefixes a key accepts, both as the list itself and as the
// sentence fragment a message embeds. Both come from one place so a client
// composing its own copy and a caller reading ours never disagree.
type reachable struct {
	names    []string
	rendered string
}

func reachableOptions(creds []domain.Credential, cfg domain.BundleConfig) reachable {
	options := reachableSpellings(creds, cfg)
	if len(options) == 0 {
		return reachable{rendered: "no provider"}
	}
	overflow := 0
	if len(options) > maxReachableOptions {
		overflow = len(options) - maxReachableOptions
		options = options[:maxReachableOptions]
	}
	quoted := make([]string, len(options))
	for i, name := range options {
		quoted[i] = fmt.Sprintf("%q", name)
	}
	rendered := strings.Join(quoted, ", ")
	if overflow > 0 {
		rendered = fmt.Sprintf("%s and %d more", rendered, overflow)
	}
	return reachable{names: options, rendered: rendered}
}

// reachableSpellings lists every prefix this key accepts: the provider
// families its credentials belong to, sorted, then the routing handles its
// providers carry. Families first because they are the spelling most callers
// already use.
func reachableSpellings(creds []domain.Credential, cfg domain.BundleConfig) []string {
	if len(creds) == 0 {
		creds = cfg.Credentials
	}
	seen := make(map[string]bool)
	var families []string
	for _, c := range creds {
		name := string(c.ProviderID)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		families = append(families, name)
	}
	slices.Sort(families)
	for _, c := range creds {
		if c.Handle != "" && !seen[c.Handle] {
			seen[c.Handle] = true
			families = append(families, c.Handle)
		}
	}
	return families
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

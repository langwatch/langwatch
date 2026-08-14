package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/retry"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func (a *App) coreDispatch(ctx context.Context, call *pipeline.Call) (*domain.Response, error) {
	if err := call.MaterializeBody(); err != nil {
		return nil, err
	}
	creds, err := a.candidateChain(ctx, call)
	if err != nil {
		return nil, err
	}
	resp, el, err := retry.Walk(ctx, a.retryOpts(call.Bundle), credentialIDs(creds),
		func(ctx context.Context, slotID string) (*domain.Response, error) {
			cred := findCredential(creds, slotID)
			resp, err := a.providers.Dispatch(ctx, call.Request, cred)
			// Raw-forward lanes hand a provider error back as a success-shaped
			// Response carrying the upstream's status + native body. Reshape it
			// into an UpstreamError INSIDE the walk so provider failures behave
			// the same on every lane: a 429/5xx falls back to the next
			// credential and drives the circuit breaker's health view, instead
			// of counting as a success that ends the chain on the first dead
			// key. The terminal forwarding guarantee is unchanged: the
			// UpstreamError carries the same verbatim body, status, and
			// retry-signaling headers to the HTTP writer.
			if err == nil && resp != nil && resp.StatusCode >= 400 {
				err = upstreamErrorFromResponse(resp)
				resp = nil
			}
			return resp, stampUpstreamProvider(err, cred)
		}, classifyProviderError)
	call.Meta.Update(func(m *pipeline.Meta) { m.FallbackCount = countFallbacks(el) })
	a.recordDispatch(ctx, call, creds, el)
	el.Release()
	resp, err = applyGovernanceMessage(resp, err)
	if err != nil {
		return nil, translateWalkError(ctx, err)
	}
	a.metrics.RecordCacheOutcome(resp.Usage)
	return resp, nil
}

func (a *App) coreDispatchStream(ctx context.Context, call *pipeline.Call) (domain.StreamIterator, error) {
	if err := call.MaterializeBody(); err != nil {
		return nil, err
	}
	creds, err := a.candidateChain(ctx, call)
	if err != nil {
		return nil, err
	}
	iter, el, err := retry.Walk(ctx, a.retryOpts(call.Bundle), credentialIDs(creds),
		func(ctx context.Context, slotID string) (domain.StreamIterator, error) {
			cred := findCredential(creds, slotID)
			iter, err := a.providers.DispatchStream(ctx, call.Request, cred)
			return iter, stampUpstreamProvider(err, cred)
		}, classifyProviderError)
	call.Meta.Update(func(m *pipeline.Meta) { m.FallbackCount = countFallbacks(el) })
	provider, model := a.recordDispatch(ctx, call, creds, el)
	el.Release()
	if _, err = applyGovernanceMessage(nil, err); err != nil {
		return nil, translateWalkError(ctx, err)
	}
	return a.metrics.WrapStream(iter, provider, model), nil
}

// upstreamErrorFromResponse reshapes a raw-forwarded provider error response
// into the error form of the same information, so the retry walk can classify
// it. Status, native body, and retry-signaling headers ride along verbatim.
func upstreamErrorFromResponse(resp *domain.Response) error {
	return &domain.UpstreamError{
		StatusCode: resp.StatusCode,
		Body:       resp.Body,
		Message:    gjson.GetBytes(resp.Body, "error.message").String(),
		ErrorType:  gjson.GetBytes(resp.Body, "error.type").String(),
		ErrorCode:  gjson.GetBytes(resp.Body, "error.code").String(),
		Headers:    resp.Headers,
	}
}

// stampUpstreamProvider names the credential's provider on an upstream error
// so the surviving error of a multi-provider chain says which account it
// came from. A no-op for gateway-taxonomy errors and already-stamped ones.
func stampUpstreamProvider(err error, cred domain.Credential) error {
	var ue *domain.UpstreamError
	if errors.As(err, &ue) && ue.Provider == "" {
		ue.Provider = string(cred.ProviderID)
	}
	return err
}

// translateWalkError maps walk outcomes that carry no upstream error onto the
// gateway's own taxonomy. A zero-attempt walk (every credential slot skipped
// by an open circuit breaker) has no provider verdict to forward; letting the
// bare sentinel escape used to fall through the transport's typed-error
// branches and surface as a 500 internal_error, right when a provider
// outage makes an actionable, retryable answer matter most.
func translateWalkError(ctx context.Context, err error) error {
	if !errors.Is(err, retry.ErrNoAttempts) {
		return err
	}
	return herr.New(ctx, domain.ErrCircuitOpen, herr.M{
		"message": "provider temporarily unavailable: repeated upstream failures opened the circuit breaker, retry shortly",
		"fault":   "provider",
	})
}

// candidateChain assembles the credentials this request may be dispatched to,
// in fallback order, or the error that explains why there are none:
//
//  1. Model-aware trim: providers that cannot serve the resolved model are
//     skipped (eligibleCredentials). A provider the request named that the
//     key cannot reach refuses here rather than dispatching to whichever
//     vendor happens to be left.
//  2. Provider allowlist: a key narrowed to specific providers cannot
//     dispatch outside them even if the bundle's credential chain is stale
//     or hand-crafted. The control plane already materializes the chain
//     filtered; this is the enforcement that makes the narrowing real at
//     the seam rather than a property of one producer.
//  3. Budget exclusions: providers whose provider-filtered blocking budgets
//     are out of money are treated like unavailable providers (contract
//     §4.6). If they empty the chain, the request is refused with the
//     budget error naming one of the excluding budgets (the last one
//     iterated; with several simultaneous exclusions any of them is an
//     accurate answer to "why was nothing dispatchable").
func (a *App) candidateChain(ctx context.Context, call *pipeline.Call) ([]domain.Credential, error) {
	creds, unreachable := eligibleCredentials(
		call.Bundle.Credentials,
		call.Request.Resolved,
	)
	if unreachable != "" {
		return nil, errProviderUnreachable(ctx, unreachable, call.Request.Resolved)
	}
	if len(creds) == 0 {
		return nil, errNoProviderConfigured(ctx)
	}

	allowed := creds[:0:0]
	for _, c := range creds {
		if call.Bundle.Config.AllowsProvider(c.ID) {
			allowed = append(allowed, c)
		}
	}
	if len(allowed) == 0 {
		return nil, errProviderNotAllowed(ctx, call.Request)
	}

	if len(call.BudgetExcludedProviders) == 0 {
		return allowed, nil
	}
	excluded := make(map[string]domain.ExcludedProvider, len(call.BudgetExcludedProviders))
	for i := range call.BudgetExcludedProviders {
		excluded[call.BudgetExcludedProviders[i].ProviderKey] = call.BudgetExcludedProviders[i]
	}
	kept := allowed[:0:0]
	var lastExcluded domain.ExcludedProvider
	for _, c := range allowed {
		if e, ok := excluded[c.ID]; ok {
			lastExcluded = e
			continue
		}
		kept = append(kept, c)
	}
	if len(kept) == 0 {
		// Every provider that could have served this request sits behind an
		// exhausted provider-filtered budget. With routing mode "none" the
		// chain was length one, so this is the plain block that mode promises.
		a.metrics.RecordBudgetBlock(lastExcluded.Budget.Scope)
		return nil, pipeline.BudgetBreachError(ctx, lastExcluded.Budget)
	}
	return kept, nil
}

// errProviderNotAllowed is the terminal answer when the provider allowlist
// leaves no credential that could serve the request: the model resolves to a
// provider this key was narrowed away from.
func errProviderNotAllowed(ctx context.Context, req *domain.Request) error {
	model := req.Model
	if req.Resolved != nil {
		model = req.Resolved.ModelID
	}
	return herr.New(ctx, domain.ErrModelNotAllowed, herr.M{
		"message": fmt.Sprintf("model %q is served by a provider this virtual key is not allowed to use. Ask the key's owner to widen its provider access", model),
		"fault":   "customer",
	})
}

// recordDispatch turns the retry engine's event log into provider metrics
// and publishes the request's provider and model back to the transport
// layer. Must run before the event log is released back to its pool.
//
// Runs after the walk rather than before it because that is the first
// point at which the provider is actually known: an implicitly resolved
// model carries no provider id of its own, and the answer is whichever
// credential ended up serving the request.
func (a *App) recordDispatch(ctx context.Context, call *pipeline.Call, creds []domain.Credential, el *retry.EventLog) (provider, model string) {
	if call.Request.Resolved != nil {
		model = a.metrics.ModelLabel(call.Bundle.Config, call.Request.Resolved.ModelID)
	}
	provider = a.dispatchProvider(call, creds, el)
	a.metrics.SetRequestLabels(ctx, provider, model)

	// Publish the ModelProvider row id the request was dispatched to. The
	// trace interceptor stamps it on the customer span as
	// langwatch.model_provider_id, which the control plane's trace fold needs
	// to debit provider-filtered budgets; without it they never accrue.
	if slotID := dispatchedSlotID(el); slotID != "" {
		call.Meta.Update(func(m *pipeline.Meta) { m.DispatchedProviderID = slotID })
	}

	var previousSlot string
	for _, e := range el.Events() {
		a.metrics.RecordProviderAttempt(e.SlotID, string(e.Reason), provider, model, e.Duration.Seconds())
		if e.Reason == retry.ReasonFallback && previousSlot != "" {
			a.metrics.RecordFallback(previousSlot, e.SlotID)
		}
		if a.breaker != nil && e.SlotID != "" {
			a.metrics.SetCircuitState(e.SlotID, int(a.breaker.State(e.SlotID)))
		}
		previousSlot = e.SlotID
	}
	return provider, model
}

// dispatchedSlotID returns the id of the last credential slot the walk
// actually dispatched against: the one that served the request on success,
// the last one tried on failure. Slots the walk skipped without dialing
// (open circuit, exhausted attempt budget, canceled context) do not count:
// reporting one would attribute spend to a provider that never saw the
// request.
func dispatchedSlotID(el *retry.EventLog) string {
	events := el.Events()
	for i := len(events) - 1; i >= 0; i-- {
		e := events[i]
		if e.SlotID == "" {
			continue
		}
		switch e.Reason {
		case retry.ReasonCircuitOpen, retry.ReasonChainExhausted, retry.ReasonContextDone:
			continue
		default:
			return e.SlotID
		}
	}
	return ""
}

// dispatchProvider names the provider this request went to. An explicit
// or aliased model resolves its own provider; an implicit one does not, so
// fall back to the credential that was actually dispatched against.
func (a *App) dispatchProvider(call *pipeline.Call, creds []domain.Credential, el *retry.EventLog) string {
	if call.Request.Resolved != nil && call.Request.Resolved.ProviderID != "" {
		return string(call.Request.Resolved.ProviderID)
	}
	events := el.Events()
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].SlotID == "" {
			continue
		}
		return string(findCredential(creds, events[i].SlotID).ProviderID)
	}
	if len(creds) > 0 {
		return string(creds[0].ProviderID)
	}
	return ""
}

// errNoProviderConfigured is the terminal answer when the bundle has zero
// eligible credentials: the organization has no model provider configured.
// Falling through to dispatch would hand Bifrost a zero-value Credential,
// which it rejects with an opaque "provider is required" 400.
func errNoProviderConfigured(ctx context.Context) error {
	return herr.New(ctx, domain.ErrNoProviderConfigured, herr.M{
		"message": "no model provider configured for this organization — add a provider API key in Settings → Model Providers",
	})
}

// errProviderUnreachable answers a request that named a provider this key has
// no credential for. Separate copy from errNoProviderConfigured: the
// organization does have providers, so "add a provider API key" is the wrong
// thing to tell someone whose real choice is to name a different model.
func errProviderUnreachable(
	ctx context.Context,
	provider domain.ProviderID,
	resolved *domain.ResolvedModel,
) error {
	message := "this key cannot reach any " + string(provider) + " provider"
	if resolved != nil && resolved.ModelID != "" {
		message += `, so it cannot serve "` + resolved.ModelID + `"`
	}
	return herr.New(ctx, domain.ErrNoProviderConfigured, herr.M{
		"message": message,
		"fault":   "customer",
	})
}

// retryOpts configures one fallback walk. The circuit breaker is passed
// through so a credential that has been failing is skipped outright
// instead of costing every request another dead round-trip.
func (a *App) retryOpts(bundle *domain.Bundle) retry.Options {
	opts := retry.Options{MaxAttempts: bundle.Config.Fallback.MaxAttempts}
	if a.breaker != nil {
		opts.Breaker = a.breaker
	}
	return opts
}

func credentialIDs(creds []domain.Credential) []string {
	ids := make([]string, len(creds))
	for i, c := range creds {
		ids[i] = c.ID
	}
	return ids
}

func findCredential(creds []domain.Credential, id string) domain.Credential {
	for _, c := range creds {
		if c.ID == id {
			return c
		}
	}
	if len(creds) > 0 {
		return creds[0]
	}
	return domain.Credential{}
}

func classifyProviderError(err error) retry.Reason {
	// A forwarded upstream response classifies by its real HTTP status: a
	// terminal client error (4xx other than 429/404) must NOT trigger
	// credential fallback — retrying a "credit balance too low" or "invalid
	// request" on the next key is pointless and only delays the terminal
	// error reaching the client. 404 IS fallback-eligible: in multi-provider
	// chains it usually means "this provider doesn't serve that model"
	// (common with custom/OpenAI-compatible providers), and the next slot
	// may. Rate-limit (429) and server errors (5xx) stay retryable so the
	// gateway still falls back across the credential chain.
	var ue *domain.UpstreamError
	if errors.As(err, &ue) {
		switch {
		case ue.StatusCode == http.StatusTooManyRequests:
			return retry.ReasonRateLimit
		case ue.StatusCode == http.StatusNotFound:
			return retry.ReasonNotFound
		case ue.StatusCode >= 500:
			return retry.ReasonRetryable5xx
		default:
			return retry.ReasonNonRetryable
		}
	}
	switch {
	case herr.IsCode(err, domain.ErrProviderTimeout):
		return retry.ReasonTimeout
	case herr.IsCode(err, domain.ErrRateLimited):
		return retry.ReasonRateLimit
	case herr.IsCode(err, domain.ErrProviderError):
		return retry.ReasonRetryable5xx
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		// A bare context error is the CALLER abandoning the request (client
		// disconnect, whole-request deadline), not a provider verdict. Real
		// upstream timeouts arrive as ErrProviderTimeout above. It says
		// nothing about the credential's health, so it must neither trigger
		// fallback nor feed the circuit breaker in either direction.
		return retry.ReasonContextDone
	default:
		return retry.ReasonNonRetryable
	}
}

func countFallbacks(el *retry.EventLog) int {
	n := 0
	for _, e := range el.Events() {
		if e.Reason == retry.ReasonFallback {
			n++
		}
	}
	return n
}

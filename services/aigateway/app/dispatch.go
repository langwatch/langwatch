package app

import (
	"context"
	"errors"
	"net/http"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/retry"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func (a *App) coreDispatch(ctx context.Context, call *pipeline.Call) (*domain.Response, error) {
	if err := call.MaterializeBody(); err != nil {
		return nil, err
	}
	creds := eligibleCredentials(call.Bundle.Credentials, call.Request.Resolved)
	if len(creds) == 0 {
		return nil, errNoProviderConfigured(ctx)
	}
	resp, el, err := retry.Walk(ctx, a.retryOpts(call.Bundle), credentialIDs(creds),
		func(ctx context.Context, slotID string) (*domain.Response, error) {
			return a.providers.Dispatch(ctx, call.Request, findCredential(creds, slotID))
		}, classifyProviderError)
	call.Meta.Update(func(m *pipeline.Meta) { m.FallbackCount = countFallbacks(el) })
	a.recordDispatch(ctx, call, creds, el)
	el.Release()
	resp, err = applyGovernanceMessage(resp, err)
	if err != nil {
		return nil, err
	}
	a.metrics.RecordCacheOutcome(resp.Usage)
	return resp, nil
}

func (a *App) coreDispatchStream(ctx context.Context, call *pipeline.Call) (domain.StreamIterator, error) {
	if err := call.MaterializeBody(); err != nil {
		return nil, err
	}
	creds := eligibleCredentials(call.Bundle.Credentials, call.Request.Resolved)
	if len(creds) == 0 {
		return nil, errNoProviderConfigured(ctx)
	}
	iter, el, err := retry.Walk(ctx, a.retryOpts(call.Bundle), credentialIDs(creds),
		func(ctx context.Context, slotID string) (domain.StreamIterator, error) {
			return a.providers.DispatchStream(ctx, call.Request, findCredential(creds, slotID))
		}, classifyProviderError)
	call.Meta.Update(func(m *pipeline.Meta) { m.FallbackCount = countFallbacks(el) })
	provider, model := a.recordDispatch(ctx, call, creds, el)
	el.Release()
	if _, err = applyGovernanceMessage(nil, err); err != nil {
		return nil, err
	}
	return a.metrics.WrapStream(iter, provider, model), nil
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

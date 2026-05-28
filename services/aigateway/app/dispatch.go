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
	resp, el, err := retry.Walk(ctx, retryOpts(call.Bundle), credentialIDs(creds),
		func(ctx context.Context, slotID string) (*domain.Response, error) {
			return a.providers.Dispatch(ctx, call.Request, findCredential(creds, slotID))
		}, classifyProviderError)
	call.Meta.FallbackCount = countFallbacks(el)
	el.Release()
	resp, err = applyGovernanceMessage(resp, err)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func (a *App) coreDispatchStream(ctx context.Context, call *pipeline.Call) (domain.StreamIterator, error) {
	if err := call.MaterializeBody(); err != nil {
		return nil, err
	}
	creds := eligibleCredentials(call.Bundle.Credentials, call.Request.Resolved)
	iter, el, err := retry.Walk(ctx, retryOpts(call.Bundle), credentialIDs(creds),
		func(ctx context.Context, slotID string) (domain.StreamIterator, error) {
			return a.providers.DispatchStream(ctx, call.Request, findCredential(creds, slotID))
		}, classifyProviderError)
	call.Meta.FallbackCount = countFallbacks(el)
	el.Release()
	if _, err = applyGovernanceMessage(nil, err); err != nil {
		return nil, err
	}
	return iter, nil
}

func retryOpts(bundle *domain.Bundle) retry.Options {
	return retry.Options{MaxAttempts: bundle.Config.Fallback.MaxAttempts}
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
	// terminal client error (4xx other than 429) must NOT trigger credential
	// fallback — retrying a "credit balance too low" or "invalid request" on
	// the next key is pointless and only delays the terminal error reaching
	// the client. Rate-limit (429) and server errors (5xx) stay retryable so
	// the gateway still falls back across the credential chain.
	var ue *domain.UpstreamError
	if errors.As(err, &ue) {
		switch {
		case ue.StatusCode == http.StatusTooManyRequests:
			return retry.ReasonRateLimit
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

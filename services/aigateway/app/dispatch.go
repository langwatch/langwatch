package app

import (
	"context"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/retry"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func (a *App) coreDispatch(ctx context.Context, call *pipeline.Call) (*domain.Response, error) {
	if err := call.MaterializeBody(); err != nil {
		return nil, err
	}
	resp, el, err := retry.Walk(ctx, retryOpts(call.Bundle), credentialIDs(call.Bundle.Credentials),
		func(ctx context.Context, slotID string) (*domain.Response, error) {
			return a.providers.Dispatch(ctx, call.Request, findCredential(call.Bundle.Credentials, slotID))
		}, classifyProviderError)
	call.Meta.FallbackCount = countFallbacks(el)
	el.Release()
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func (a *App) coreDispatchStream(ctx context.Context, call *pipeline.Call) (domain.StreamIterator, error) {
	if err := call.MaterializeBody(); err != nil {
		return nil, err
	}
	iter, el, err := retry.Walk(ctx, retryOpts(call.Bundle), credentialIDs(call.Bundle.Credentials),
		func(ctx context.Context, slotID string) (domain.StreamIterator, error) {
			return a.providers.DispatchStream(ctx, call.Request, findCredential(call.Bundle.Credentials, slotID))
		}, classifyProviderError)
	call.Meta.FallbackCount = countFallbacks(el)
	el.Release()
	if err != nil {
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

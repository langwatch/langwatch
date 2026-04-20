package app

import (
	"context"
	"encoding/json"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/ksuid"
	"github.com/langwatch/langwatch/pkg/retry"
	"github.com/langwatch/langwatch/services/aigateway/app/cachecontrol"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// HandleResult is the unified result from Handle — the single entry point
// for transport. Streaming indicates which field to read.
type HandleResult struct {
	Meta      DispatchMeta
	Streaming bool
	// Set when !Streaming
	Response *domain.Response
	// Set when Streaming
	Iterator domain.StreamIterator
}

// DispatchMeta holds metadata accumulated during dispatch for response headers.
type DispatchMeta struct {
	GatewayRequestID string
	FallbackCount    int
	BudgetWarnings   []string
	CacheMode        string
}

// Handle is the single entry point for transport. It parses the body,
// determines streaming vs non-streaming, and dispatches accordingly.
func (a *App) Handle(ctx context.Context, bundle *domain.Bundle, reqType domain.RequestType, body []byte) (*HandleResult, error) {
	model, streaming := peekModelAndStream(body)
	req := &domain.Request{
		Type:      reqType,
		Model:     model,
		Body:      body,
		Streaming: streaming,
	}

	if streaming {
		result, err := a.dispatchStream(ctx, bundle, req)
		if err != nil {
			return nil, err
		}
		return &HandleResult{Meta: result.Meta, Streaming: true, Iterator: result.Iterator}, nil
	}

	result, err := a.dispatch(ctx, bundle, req)
	if err != nil {
		return nil, err
	}
	return &HandleResult{Meta: result.Meta, Response: result.Response}, nil
}

// dispatchResult carries the response plus metadata (internal).
type dispatchResult struct {
	Response *domain.Response
	Meta     DispatchMeta
}

// streamResult carries the iterator plus metadata (internal).
type streamResult struct {
	Iterator domain.StreamIterator
	Meta     DispatchMeta
}

// dispatch handles a non-streaming request.
func (a *App) dispatch(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (*dispatchResult, error) {
	meta, err := a.preDispatch(ctx, bundle, req)
	if err != nil {
		return nil, err
	}

	start := time.Now()
	resp, events, dispatchErr := retry.Walk(ctx, a.retryOpts(bundle), credentialIDs(bundle.Credentials),
		func(ctx context.Context, slotID string) (*domain.Response, error) {
			return a.providers.Dispatch(ctx, req, findCredential(bundle.Credentials, slotID))
		}, classifyProviderError)

	meta.FallbackCount = countFallbacks(events)
	if dispatchErr != nil {
		return nil, dispatchErr
	}

	if err := a.postDispatch(ctx, bundle, req, resp); err != nil {
		return nil, err
	}

	a.recordCompletion(ctx, bundle, req, resp.Usage, time.Since(start), false)
	return &dispatchResult{Response: resp, Meta: meta}, nil
}

// dispatchStream handles a streaming request.
func (a *App) dispatchStream(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (*streamResult, error) {
	meta, err := a.preDispatch(ctx, bundle, req)
	if err != nil {
		return nil, err
	}

	iter, events, dispatchErr := retry.Walk(ctx, a.retryOpts(bundle), credentialIDs(bundle.Credentials),
		func(ctx context.Context, slotID string) (domain.StreamIterator, error) {
			return a.providers.DispatchStream(ctx, req, findCredential(bundle.Credentials, slotID))
		}, classifyProviderError)

	meta.FallbackCount = countFallbacks(events)
	if dispatchErr != nil {
		return nil, dispatchErr
	}

	wrapped := newGuardedStream(iter, a, bundle, req)
	return &streamResult{Iterator: wrapped, Meta: meta}, nil
}

// --- Pre/post dispatch ---

func (a *App) preDispatch(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (DispatchMeta, error) {
	meta := DispatchMeta{
		GatewayRequestID: ksuid.Generate(ctx, ksuid.ResourceGatewayRequest).String(),
	}

	if a.ratelimit != nil {
		if err := a.ratelimit.Allow(ctx, bundle.VirtualKeyID, bundle.Config.RateLimits); err != nil {
			return meta, herr.New(ctx, domain.ErrRateLimited, nil, err)
		}
	}

	if a.blocked != nil && len(bundle.Config.BlockedPatterns) > 0 {
		if err := a.blocked.Check(ctx, bundle.Config.BlockedPatterns, req.Body); err != nil {
			return meta, err
		}
	}

	if a.models != nil {
		resolved, err := a.models.Resolve(ctx, req.Model, bundle.Config)
		if err != nil {
			return meta, err
		}
		req.Resolved = resolved
		if req.Model != resolved.ModelID {
			req.Body = rewriteModel(req.Body, resolved.ModelID)
		}
	}

	if a.cache != nil && len(bundle.Config.CacheRules) > 0 {
		if decision := a.cache.Evaluate(ctx, bundle.Config.CacheRules, req.Model); decision != nil {
			meta.CacheMode = string(decision.Action)
			req.Body = cachecontrol.Apply(req.Body, decision.Action, req.Type)
		}
	}

	if a.budget != nil {
		verdict, err := a.budget.Precheck(ctx, bundle)
		if err != nil {
			a.logger.Warn("budget_precheck_error", zap.Error(err))
		} else if verdict == BudgetBlock {
			return meta, herr.New(ctx, domain.ErrBudgetExceeded, nil)
		} else if verdict == BudgetWarn {
			meta.BudgetWarnings = append(meta.BudgetWarnings, "near_limit")
		}
	}

	if a.guardrails != nil && len(bundle.Config.Guardrails) > 0 {
		verdict, err := a.guardrails.EvaluatePre(ctx, bundle, req)
		if err != nil {
			a.logger.Warn("guardrail_pre_error", zap.Error(err))
		} else if verdict.Action == GuardrailBlock {
			return meta, herr.New(ctx, domain.ErrGuardrailBlocked, herr.M{"message": verdict.Message})
		}
	}

	return meta, nil
}

func (a *App) postDispatch(ctx context.Context, bundle *domain.Bundle, req *domain.Request, resp *domain.Response) error {
	if a.guardrails != nil && len(bundle.Config.Guardrails) > 0 {
		verdict, err := a.guardrails.EvaluatePost(ctx, bundle, req, resp)
		if err != nil {
			a.logger.Warn("guardrail_post_error", zap.Error(err))
		} else if verdict.Action == GuardrailBlock {
			return herr.New(ctx, domain.ErrGuardrailBlocked, herr.M{"message": verdict.Message})
		}
	}

	if a.budget != nil {
		a.budget.Debit(ctx, bundle, resp.Usage)
	}

	return nil
}

func (a *App) recordCompletion(ctx context.Context, bundle *domain.Bundle, req *domain.Request, usage domain.Usage, duration time.Duration, streaming bool) {
	if a.traces == nil || req.Resolved == nil {
		return
	}
	a.traces.Emit(ctx, AITraceParams{
		ProjectID:   bundle.ProjectID,
		Model:       req.Resolved.ModelID,
		ProviderID:  req.Resolved.ProviderID,
		Usage:       usage,
		DurationMS:  duration.Milliseconds(),
		Streaming:   streaming,
		RequestType: req.Type,
	})
}

func (a *App) retryOpts(bundle *domain.Bundle) retry.Options {
	return retry.Options{MaxAttempts: bundle.Config.Fallback.MaxAttempts}
}

// --- Helpers ---

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

func countFallbacks(events []retry.Event) int {
	n := 0
	for _, e := range events {
		if e.Reason == retry.ReasonFallback {
			n++
		}
	}
	return n
}

func rewriteModel(body []byte, model string) []byte {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(body, &obj); err != nil {
		return body
	}
	raw, _ := json.Marshal(model)
	obj["model"] = raw
	out, err := json.Marshal(obj)
	if err != nil {
		return body
	}
	return out
}

func peekModelAndStream(body []byte) (model string, streaming bool) {
	var peek struct {
		Model  string `json:"model"`
		Stream bool   `json:"stream"`
	}
	_ = json.Unmarshal(body, &peek)
	return peek.Model, peek.Stream
}

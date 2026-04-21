package app

import (
	"context"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// AuthResolver resolves a bearer token into a Bundle.
type AuthResolver interface {
	Resolve(ctx context.Context, token string) (*domain.Bundle, error)
}

// ProviderRouter dispatches requests to the correct provider.
type ProviderRouter interface {
	Dispatch(ctx context.Context, req *domain.Request, cred domain.Credential) (*domain.Response, error)
	DispatchStream(ctx context.Context, req *domain.Request, cred domain.Credential) (domain.StreamIterator, error)
	ListModels(ctx context.Context, creds []domain.Credential) ([]domain.Model, error)
}

// BudgetChecker validates and records spending.
type BudgetChecker interface {
	Precheck(ctx context.Context, bundle *domain.Bundle) (domain.BudgetVerdict, error)
	Debit(ctx context.Context, bundle *domain.Bundle, usage domain.Usage)
}

// GuardrailEvaluator runs guardrail policies against request/response content.
type GuardrailEvaluator interface {
	EvaluatePre(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (domain.GuardrailVerdict, error)
	EvaluatePost(ctx context.Context, bundle *domain.Bundle, req *domain.Request, resp *domain.Response) (domain.GuardrailVerdict, error)
	EvaluateChunk(ctx context.Context, bundle *domain.Bundle, req *domain.Request, chunk []byte) (domain.GuardrailVerdict, error)
}

// RateLimiter enforces per-VK rate limits.
// Allow returns nil if the request is permitted, or a non-nil error (typically
// wrapping domain.ErrRateLimited) if the request should be rejected.
type RateLimiter interface {
	Allow(ctx context.Context, vkID string, limits domain.RateLimits) error
}

// PolicyMatcher checks request content against policy rules.
type PolicyMatcher interface {
	Check(ctx context.Context, rules []domain.PolicyRule, body []byte) error
}

// CacheEvaluator evaluates cache rules for a request.
type CacheEvaluator interface {
	Evaluate(ctx context.Context, rules []domain.CacheRule, model string) *domain.CacheDecision
}

// ModelResolver resolves a raw model string against bundle config.
type ModelResolver interface {
	Resolve(ctx context.Context, rawModel string, config domain.BundleConfig) (*domain.ResolvedModel, error)
}

// AITraceEmitter exports AI completion data to the customer's project.
type AITraceEmitter interface {
	BeginSpan(ctx context.Context, projectID string, reqType domain.RequestType) (context.Context, string)
	EndSpan(ctx context.Context, params domain.AITraceParams)
}

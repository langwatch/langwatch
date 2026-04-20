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
	// Precheck returns whether the request is allowed to proceed given budget.
	Precheck(ctx context.Context, bundle *domain.Bundle) (BudgetVerdict, error)
	// Debit records cost after a successful response.
	Debit(ctx context.Context, bundle *domain.Bundle, usage domain.Usage)
}

// BudgetVerdict is the outcome of a budget precheck.
type BudgetVerdict int

const (
	BudgetAllow BudgetVerdict = iota
	BudgetWarn
	BudgetBlock
)

// GuardrailEvaluator runs guardrail policies against request/response content.
type GuardrailEvaluator interface {
	EvaluatePre(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (GuardrailVerdict, error)
	EvaluatePost(ctx context.Context, bundle *domain.Bundle, req *domain.Request, resp *domain.Response) (GuardrailVerdict, error)
	EvaluateChunk(ctx context.Context, bundle *domain.Bundle, req *domain.Request, chunk []byte) (GuardrailVerdict, error)
}

// GuardrailVerdict is the outcome of a guardrail evaluation.
type GuardrailVerdict struct {
	Action  GuardrailAction
	Message string // explanation when blocked
}

// GuardrailAction is the guardrail decision.
type GuardrailAction int

const (
	GuardrailAllow GuardrailAction = iota
	GuardrailBlock
	GuardrailModify
)

// RateLimiter enforces per-VK rate limits.
// Allow returns nil if the request is permitted, or a non-nil error (typically
// wrapping domain.ErrRateLimited) if the request should be rejected.
type RateLimiter interface {
	Allow(ctx context.Context, vkID string, limits domain.RateLimits) error
}

// BlockedMatcher checks request content against blocked patterns.
type BlockedMatcher interface {
	Check(ctx context.Context, patterns []domain.BlockedPattern, body []byte) error
}

// CacheEvaluator evaluates cache rules for a request.
type CacheEvaluator interface {
	Evaluate(ctx context.Context, rules []domain.CacheRule, model string) *CacheDecision
}

// CacheDecision is the result of cache rule evaluation.
type CacheDecision struct {
	Action domain.CacheAction
	RuleID string // which rule matched (empty = default)
}

// ModelResolver resolves a raw model string against bundle config.
type ModelResolver interface {
	Resolve(ctx context.Context, rawModel string, config domain.BundleConfig) (*domain.ResolvedModel, error)
}

// AITraceEmitter exports AI completion data to the customer's project.
type AITraceEmitter interface {
	Emit(ctx context.Context, params AITraceParams)
}

// AITraceParams holds the data for a customer AI trace.
type AITraceParams struct {
	ProjectID    string
	Model        string
	ProviderID   domain.ProviderID
	Usage        domain.Usage
	DurationMS   int64
	Streaming    bool
	RequestType  domain.RequestType
}

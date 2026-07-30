package app

import (
	"context"

	"github.com/langwatch/langwatch/pkg/breaker"
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
	// ListModels aggregates the chain's catalogs. Alongside the models it
	// reports discovery gaps: providers that dispatch can route to but
	// that contributed no catalog (and why), so the surface never silently
	// reads as "no models" for a chain that can serve traffic.
	ListModels(ctx context.Context, creds []domain.Credential) ([]domain.Model, []domain.ModelDiscoveryGap, error)
}

// BudgetChecker validates spending pre-flight. Cost recording is handled
// by the trace-fold reactor on the control plane (folds OTel span usage
// into the ClickHouse budget ledger), not on the gateway hot path.
type BudgetChecker interface {
	Precheck(ctx context.Context, bundle *domain.Bundle) (domain.BudgetDecision, error)
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
	Evaluate(ctx context.Context, rules []domain.CacheRule, eval domain.CacheEvalContext) *domain.CacheDecision
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

// MetricsRecorder counts the operator-facing signals only the app layer
// can observe: what happened on each dispatch attempt, and what the
// gateway decided on the way there. Signals that belong to a single
// adapter (auth cache tiers, rate-limit dimensions, budget scopes) are
// recorded by that adapter instead of being funneled through here.
type MetricsRecorder interface {
	RecordProviderAttempt(credentialID, outcome, provider, model string, seconds float64)
	RecordFallback(fromCredential, toCredential string)
	SetCircuitState(credentialID string, state int)
	RecordCacheOutcome(usage domain.Usage)
	RecordCacheRuleHit(ruleID, mode string)

	// RecordBudgetBlock counts a request rejected on budget. The budget
	// checker counts the plain blocks it decides itself; this port entry
	// exists for the one budget rejection only the app layer can see:
	// provider-filtered exclusions emptying the candidate chain, which is
	// decided at dispatch, after the checker has already answered.
	RecordBudgetBlock(scope string)

	// SetRequestLabels hands the resolved provider and model back to the
	// transport layer, which cannot see them: routing and model resolution
	// both happen after the HTTP middleware has already been entered.
	SetRequestLabels(ctx context.Context, provider, model string)

	// WrapStream decorates a stream so the open-stream gauge and the
	// missing-usage counter follow it to close.
	WrapStream(iter domain.StreamIterator, provider, model string) domain.StreamIterator

	// ModelLabel folds a model name onto a value that is safe to use as a
	// label. A virtual key may permit arbitrary model names, so the raw
	// request field is caller-controlled and would otherwise let one client
	// mint unbounded series.
	ModelLabel(config domain.BundleConfig, model string) string
}

// CircuitBreaker preempts dispatch to a credential that has been failing,
// and reports the state so operators can see which provider is cut off.
type CircuitBreaker interface {
	Allow(id string) bool
	RecordSuccess(id string)
	RecordFailure(id string)
	State(id string) breaker.State
}

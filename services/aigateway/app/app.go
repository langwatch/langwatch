// Package app is the application layer for the AI Gateway service.
// It orchestrates domain logic via consumer-defined interfaces (ports.go).
package app

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// App is the application orchestrator. All dependencies are interfaces
// defined in ports.go, making the app trivially testable.
type App struct {
	auth       AuthResolver
	providers  ProviderRouter
	budget     BudgetChecker
	guardrails GuardrailEvaluator
	ratelimit  RateLimiter
	policy     PolicyMatcher
	cache      CacheEvaluator
	models     ModelResolver
	traces     AITraceEmitter
	metrics    MetricsRecorder
	breaker    CircuitBreaker
	logger     *zap.Logger

	pipeline pipeline.Pipeline
}

// Option configures the App.
type Option func(*App)

func WithAuth(a AuthResolver) Option             { return func(app *App) { app.auth = a } }
func WithProviders(p ProviderRouter) Option      { return func(app *App) { app.providers = p } }
func WithBudget(b BudgetChecker) Option          { return func(app *App) { app.budget = b } }
func WithGuardrails(g GuardrailEvaluator) Option { return func(app *App) { app.guardrails = g } }
func WithRateLimiter(r RateLimiter) Option       { return func(app *App) { app.ratelimit = r } }
func WithPolicy(p PolicyMatcher) Option          { return func(app *App) { app.policy = p } }
func WithCache(c CacheEvaluator) Option          { return func(app *App) { app.cache = c } }
func WithModels(m ModelResolver) Option          { return func(app *App) { app.models = m } }
func WithTraces(t AITraceEmitter) Option         { return func(app *App) { app.traces = t } }
func WithMetrics(m MetricsRecorder) Option       { return func(app *App) { app.metrics = m } }
func WithCircuitBreaker(b CircuitBreaker) Option { return func(app *App) { app.breaker = b } }
func WithLogger(l *zap.Logger) Option            { return func(app *App) { app.logger = l } }

// New creates an App with the given options and builds the dispatch pipeline.
func New(opts ...Option) *App {
	app := &App{}
	for _, opt := range opts {
		opt(app)
	}
	if app.logger == nil {
		app.logger, _ = zap.NewProduction()
	}
	if app.metrics == nil {
		app.metrics = discardMetrics{}
	}

	app.pipeline = pipeline.Build(
		app.buildInterceptors(),
		app.coreDispatch,
		app.coreDispatchStream,
	)

	return app
}

func (a *App) buildInterceptors() []pipeline.Interceptor {
	var chain []pipeline.Interceptor
	if a.ratelimit != nil {
		chain = append(chain, pipeline.RateLimit(a.ratelimit.Allow))
	}
	if a.policy != nil {
		chain = append(chain, pipeline.Policy(a.policy.Check))
	}
	if a.models != nil {
		chain = append(chain, pipeline.ModelResolve(a.models.Resolve))
	}
	if a.cache != nil {
		chain = append(chain, pipeline.Cache(a.evaluateCache))
	}
	if a.budget != nil {
		chain = append(chain, pipeline.Budget(a.budget.Precheck, a.logger))
	}
	if a.guardrails != nil {
		chain = append(chain, pipeline.Guardrail(
			a.guardrails.EvaluatePre,
			a.guardrails.EvaluatePost,
			a.guardrails.EvaluateChunk,
			a.logger,
		))
	}
	if a.traces != nil {
		chain = append(chain, pipeline.Trace(a.traces.BeginSpan, a.traces.EndSpan))
	}
	return chain
}

// evaluateCache runs cache-rule evaluation and counts the rules that
// fire. A non-nil decision is always applied by the interceptor, so a
// decision here is a rule hit.
func (a *App) evaluateCache(ctx context.Context, rules []domain.CacheRule, eval domain.CacheEvalContext) *domain.CacheDecision {
	decision := a.cache.Evaluate(ctx, rules, eval)
	if decision != nil {
		a.metrics.RecordCacheRuleHit(decision.RuleID, string(decision.Action))
	}
	return decision
}

// Auth returns the auth resolver (for use by transport middleware).
func (a *App) Auth() AuthResolver { return a.auth }

// discardMetrics is the default recorder, so the app never has to
// nil-check the port. Tests and partial wirings get it for free.
type discardMetrics struct{}

func (discardMetrics) RecordProviderAttempt(_, _, _, _ string, _ float64) {}
func (discardMetrics) RecordFallback(_, _ string)                         {}
func (discardMetrics) SetCircuitState(_ string, _ int)                    {}
func (discardMetrics) RecordCacheOutcome(_ domain.Usage)                  {}
func (discardMetrics) RecordCacheRuleHit(_, _ string)                     {}
func (discardMetrics) SetRequestLabels(_ context.Context, _, _ string)    {}
func (discardMetrics) ModelLabel(_ domain.BundleConfig, model string) string {
	return model
}

func (discardMetrics) WrapStream(iter domain.StreamIterator, _, _ string) domain.StreamIterator {
	return iter
}

// ListModels returns models available to the bundle's virtual key.
func (a *App) ListModels(ctx context.Context, bundle *domain.Bundle) ([]domain.Model, error) {
	if a.providers == nil {
		return nil, nil
	}
	return a.providers.ListModels(ctx, bundle.Credentials)
}

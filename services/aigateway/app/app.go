// Package app is the application layer for the AI Gateway service.
// It orchestrates domain logic via consumer-defined interfaces (ports.go).
package app

import (
	"context"
	"regexp"
	"sort"

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
		chain = append(chain, pipeline.Cache(a.cache.Evaluate))
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

// Auth returns the auth resolver (for use by transport middleware).
func (a *App) Auth() AuthResolver { return a.auth }

// ListModels returns models available to the bundle's virtual key:
// alias names, plus either the configured allowlist (authoritative when
// set — anything outside it is blocked at dispatch, so upstream endpoints
// are not queried) or models discovered from self-hosted endpoints in the
// credential chain. Models matching a deny policy rule are filtered out.
func (a *App) ListModels(ctx context.Context, bundle *domain.Bundle) ([]domain.Model, error) {
	cfg := bundle.Config
	var models []domain.Model
	seen := make(map[string]bool)
	add := func(m domain.Model) {
		if m.ID == "" || seen[m.ID] {
			return
		}
		seen[m.ID] = true
		models = append(models, m)
	}

	for name, alias := range cfg.ModelAliases {
		add(domain.Model{ID: name, Name: name, ProviderID: alias.ProviderID})
	}

	if len(cfg.AllowedModels) > 0 {
		for _, id := range cfg.AllowedModels {
			add(domain.Model{ID: id, Name: id})
		}
	} else if a.providers != nil {
		discovered, err := a.providers.ListModels(ctx, bundle.Credentials)
		if err != nil {
			return nil, err
		}
		for _, m := range discovered {
			add(m)
		}
	}

	models = filterDeniedModels(models, cfg.PolicyRules)
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	return models, nil
}

// filterDeniedModels drops models matching a deny rule targeting models.
// Invalid patterns are skipped: the list is discovery, not enforcement —
// dispatch-time policy evaluation remains the authority.
func filterDeniedModels(models []domain.Model, rules []domain.PolicyRule) []domain.Model {
	var deny []*regexp.Regexp
	for _, r := range rules {
		if r.Target != domain.PolicyTargetModel || r.Type != domain.PolicyDeny {
			continue
		}
		if re, err := regexp.Compile(r.Pattern); err == nil {
			deny = append(deny, re)
		}
	}
	if len(deny) == 0 {
		return models
	}
	kept := models[:0]
	for _, m := range models {
		denied := false
		for _, re := range deny {
			if re.MatchString(m.ID) {
				denied = true
				break
			}
		}
		if !denied {
			kept = append(kept, m)
		}
	}
	return kept
}

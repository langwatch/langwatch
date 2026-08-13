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
	spend      pipeline.SpendEmitter
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

// WithSpend wires the spend emitter that records billing lifecycle events.
func WithSpend(e pipeline.SpendEmitter) Option   { return func(app *App) { app.spend = e } }
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
	// Spend is OUTERMOST so every request that reaches the pipeline admits
	// a spend record, including ones the chain itself rejects further down.
	if a.spend != nil {
		chain = append(chain, pipeline.Spend(a.spend))
	}
	if a.ratelimit != nil {
		chain = append(chain, pipeline.RateLimit(a.ratelimit.Allow))
	}
	if a.policy != nil {
		chain = append(chain, pipeline.Policy(a.policy.Check))
		if a.models == nil {
			// Model rules are enforced from the model resolver, on the
			// resolved id. Without a resolver there is nothing to enforce
			// them against, and an unenforced deny rule is the one failure
			// mode that looks exactly like a working one.
			a.logger.Warn("policy_model_rules_unenforced_without_resolver")
		}
	}
	if a.models != nil {
		var checkModel pipeline.CheckModelFunc
		if a.policy != nil {
			checkModel = a.policy.CheckModel
		}
		chain = append(chain, pipeline.ModelResolve(a.models.Resolve, checkModel))
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
func (discardMetrics) RecordBudgetBlock(_ string)                         {}
func (discardMetrics) SetRequestLabels(_ context.Context, _, _ string)    {}
func (discardMetrics) ModelLabel(_ domain.BundleConfig, model string) string {
	return model
}

func (discardMetrics) WrapStream(iter domain.StreamIterator, _, _ string) domain.StreamIterator {
	return iter
}

// ListModels returns models available to the bundle's virtual key:
// alias names, plus either the configured allowlist (authoritative when
// set, anything outside it is blocked at dispatch, so upstream endpoints
// are not queried) or models discovered from the credential chain's
// catalogs. Models matching a deny policy rule are filtered out.
//
// The second return reports discovery gaps: providers that dispatch can
// route to but that contributed nothing to the list (catalog probe
// failed, or the provider's models cannot be enumerated). Empty whenever discovery did
// not run — a literal allowlist is authoritative, so there is no gap to
// report.
func (a *App) ListModels(ctx context.Context, bundle *domain.Bundle) ([]domain.Model, []domain.ModelDiscoveryGap, error) {
	cfg := bundle.Config
	var models []domain.Model
	var gaps []domain.ModelDiscoveryGap
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
		// AllowedModels is a bare ID list with no provider association of
		// its own (unlike aliases and discovered models). Only attribute a
		// provider when the bundle's credential chain is unambiguous —
		// guessing among multiple candidate providers would be more
		// misleading than reporting none.
		providerID := soleCredentialProviderID(bundle.Credentials)
		hasWildcards := false
		for _, id := range cfg.AllowedModels {
			// A wildcard entry ("claude-haiku-*") is a pattern, not a
			// model a client can request: listing it verbatim puts a
			// literal "claude-haiku-*" in the model picker, which
			// dispatch then forwards upstream as a model name that no
			// provider has. Concrete IDs behind the pattern come from
			// discovery instead.
			if domain.ModelPatternIsWildcard(id) {
				hasWildcards = true
				continue
			}
			add(domain.Model{ID: id, Name: id, ProviderID: providerID})
		}
		if hasWildcards {
			discoveredGaps, err := a.addDiscovered(ctx, bundle, cfg, add)
			if err != nil {
				return nil, nil, err
			}
			gaps = discoveredGaps
		}
	} else {
		discoveredGaps, err := a.addDiscovered(ctx, bundle, cfg, add)
		if err != nil {
			return nil, nil, err
		}
		gaps = discoveredGaps
	}

	models = filterModelsByPolicy(models, cfg.PolicyRules, a.logger)
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	return models, gaps, nil
}

// addDiscovered asks the credential chain's catalogs for their models and
// feeds the ones the VK may actually request into add, passing the
// chain's discovery gaps through. Discovery answers with whatever the
// endpoint serves, so the allowlist is applied here too: dispatch rejects
// anything outside it, and listing a model the VK cannot call is worse
// than omitting it.
func (a *App) addDiscovered(ctx context.Context, bundle *domain.Bundle, cfg domain.BundleConfig, add func(domain.Model)) ([]domain.ModelDiscoveryGap, error) {
	if a.providers == nil {
		return nil, nil
	}
	discovered, gaps, err := a.providers.ListModels(ctx, bundle.Credentials)
	if err != nil {
		return nil, err
	}
	for _, m := range discovered {
		if !cfg.AllowsModel(m.ID) {
			continue
		}
		add(m)
	}
	return gaps, nil
}

// soleCredentialProviderID returns the credential chain's provider when
// every credential shares one, and "" when the chain is empty or spans
// more than one provider (nothing to unambiguously attribute to).
func soleCredentialProviderID(creds []domain.Credential) domain.ProviderID {
	var providerID domain.ProviderID
	for i, cred := range creds {
		if i == 0 {
			providerID = cred.ProviderID
			continue
		}
		if cred.ProviderID != providerID {
			return ""
		}
	}
	return providerID
}

// filterModelsByPolicy mirrors dispatch-time model policy: models matching
// a deny rule are dropped, and when any allow rule targets models, only
// models matching one survive (the policy matcher rejects the rest with
// "is not in allowlist"). Invalid patterns are skipped (not failed
// closed, unlike dispatch-time Matcher.Check): the list is discovery, not
// enforcement — dispatch-time evaluation remains the authority and would
// still reject a request against a listed model if its pattern is bad.
// The skip is logged so a typo'd rule doesn't silently fail to hide a
// model from the list without a trace anywhere.
func filterModelsByPolicy(models []domain.Model, rules []domain.PolicyRule, logger *zap.Logger) []domain.Model {
	var deny, allow []*regexp.Regexp
	for _, r := range rules {
		if r.Target != domain.PolicyTargetModel {
			continue
		}
		re, err := regexp.Compile(r.Pattern)
		if err != nil {
			if logger != nil {
				logger.Warn("model policy rule has invalid pattern, skipping for listing",
					zap.String("pattern", r.Pattern), zap.Error(err))
			}
			continue
		}
		switch r.Type {
		case domain.PolicyDeny:
			deny = append(deny, re)
		case domain.PolicyAllow:
			allow = append(allow, re)
		}
	}
	if len(deny) == 0 && len(allow) == 0 {
		return models
	}
	matchesAny := func(id string, patterns []*regexp.Regexp) bool {
		for _, re := range patterns {
			if re.MatchString(id) {
				return true
			}
		}
		return false
	}
	kept := models[:0]
	for _, m := range models {
		if matchesAny(m.ID, deny) {
			continue
		}
		if len(allow) > 0 && !matchesAny(m.ID, allow) {
			continue
		}
		kept = append(kept, m)
	}
	return kept
}

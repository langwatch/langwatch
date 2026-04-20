// Package app is the application layer for the AI Gateway service.
// It orchestrates domain logic via consumer-defined interfaces (ports.go).
package app

import (
	"context"

	"go.uber.org/zap"

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
	blocked    BlockedMatcher
	cache      CacheEvaluator
	models     ModelResolver
	traces     AITraceEmitter
	logger     *zap.Logger
}

// Option configures the App.
type Option func(*App)

func WithAuth(a AuthResolver) Option           { return func(app *App) { app.auth = a } }
func WithProviders(p ProviderRouter) Option     { return func(app *App) { app.providers = p } }
func WithBudget(b BudgetChecker) Option         { return func(app *App) { app.budget = b } }
func WithGuardrails(g GuardrailEvaluator) Option { return func(app *App) { app.guardrails = g } }
func WithRateLimiter(r RateLimiter) Option      { return func(app *App) { app.ratelimit = r } }
func WithBlocked(b BlockedMatcher) Option       { return func(app *App) { app.blocked = b } }
func WithCache(c CacheEvaluator) Option         { return func(app *App) { app.cache = c } }
func WithModels(m ModelResolver) Option         { return func(app *App) { app.models = m } }
func WithTraces(t AITraceEmitter) Option        { return func(app *App) { app.traces = t } }
func WithLogger(l *zap.Logger) Option           { return func(app *App) { app.logger = l } }

// New creates an App with the given options.
func New(opts ...Option) *App {
	app := &App{}
	for _, opt := range opts {
		opt(app)
	}
	if app.logger == nil {
		app.logger, _ = zap.NewProduction()
	}
	return app
}

// Auth returns the auth resolver (for use by transport middleware).
func (a *App) Auth() AuthResolver { return a.auth }

// ListModels returns models available to the bundle's virtual key.
func (a *App) ListModels(ctx context.Context, bundle *domain.Bundle) ([]domain.Model, error) {
	if a.providers == nil {
		return nil, nil
	}
	return a.providers.ListModels(ctx, bundle.Credentials)
}

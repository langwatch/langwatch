// Package cmd exposes the aigateway service entrypoint for the mono-binary.
package cmd

import (
	"context"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/aigateway"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaymetrics"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaytracer"
	"github.com/langwatch/langwatch/services/aigateway/app"
)

// Root is the service entrypoint called by cmd/service.
func Root(ctx context.Context, _ []string) error {
	cfg, err := aigateway.LoadConfig(ctx)
	if err != nil {
		return err
	}

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-aigateway"
	info.Environment = cfg.Environment
	ctx = contexts.SetServiceInfo(ctx, *info)

	ctx, deps, err := aigateway.NewDeps(ctx, cfg)
	if err != nil {
		return err
	}

	opts := []app.Option{
		app.WithAuth(deps.Auth),
		app.WithProviders(deps.Providers),
		app.WithRateLimiter(deps.RateLimiter),
		app.WithBudget(deps.BudgetChecker),
		// Wrapped so every guardrail verdict is counted, including the
		// fail-open ones a plain allow would otherwise hide.
		app.WithGuardrails(gatewaymetrics.WithGuardrailMetrics(deps.ControlPlane, deps.Metrics)),
		app.WithPolicy(deps.Policy),
		app.WithCache(deps.Cache),
		app.WithModels(deps.Models),
		// Wrapped so the gateway's own span gets the model/usage/outcome
		// metadata too — content stays on the customer-bound span only.
		app.WithTraces(gatewaytracer.WithInternalStamping(deps.TraceBridge)),
		app.WithMetrics(deps.Metrics),
		app.WithCircuitBreaker(deps.Breaker),
		app.WithLogger(deps.Logger),
		// The control plane owns the record of open realtime voice sessions:
		// a session outlives the request that minted it, and its per-key cap
		// has to be counted somewhere every replica sees.
		app.WithRealtimeSessions(deps.ControlPlane),
	}
	// Appended conditionally on the concrete type: a nil adapter wrapped in
	// the interface would defeat the app's nil check.
	if deps.SpendEmitter != nil {
		opts = append(opts, app.WithSpend(deps.SpendEmitter))
	}
	application := app.New(opts...)

	return aigateway.Serve(ctx, application, deps, cfg)
}

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

// Options are the per-instance overrides a host applies on top of the
// service's own configuration.
//
// Addr exists because two services sharing one process cannot both read
// SERVER_ADDR: the combined Go development process (`service combined`) hands
// each one the port it was allocated instead. Empty means "whatever the
// service's own configuration resolved", which is what every deployment uses.
type Options struct {
	Addr string
}

// Root is the service entrypoint called by cmd/service.
func Root(ctx context.Context, _ []string) error {
	return Run(ctx, Options{})
}

// Run boots the AI Gateway with the host's overrides applied.
func Run(ctx context.Context, overrides Options) error {
	cfg, err := aigateway.LoadConfig(ctx)
	if err != nil {
		return err
	}
	if overrides.Addr != "" {
		cfg.Server.Addr = overrides.Addr
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

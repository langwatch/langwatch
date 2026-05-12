// Package cmd exposes the aigateway service entrypoint for the mono-binary.
package cmd

import (
	"context"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/aigateway"
	"github.com/langwatch/langwatch/services/aigateway/app"
)

// Root is the service entrypoint called by cmd/service.
func Root(ctx context.Context, _ []string) error {
	cfg, err := aigateway.LoadConfig(ctx)
	if err != nil {
		return err
	}

	info := contexts.MustGetServiceInfo(ctx)
	info.Environment = cfg.Environment
	ctx = contexts.SetServiceInfo(ctx, *info)

	ctx, deps, err := aigateway.NewDeps(ctx, cfg)
	if err != nil {
		return err
	}

	application := app.New(
		app.WithAuth(deps.Auth),
		app.WithProviders(deps.Providers),
		app.WithRateLimiter(deps.RateLimiter),
		app.WithBudget(deps.BudgetChecker),
		app.WithGuardrails(deps.ControlPlane),
		app.WithPolicy(deps.Policy),
		app.WithCache(deps.Cache),
		app.WithModels(deps.Models),
		app.WithTraces(deps.TraceBridge),
		app.WithLogger(deps.Logger),
	)

	return aigateway.Serve(ctx, application, deps, cfg)
}

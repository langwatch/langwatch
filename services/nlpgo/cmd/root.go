// Package cmd exposes the nlpgo service entrypoint for the mono-binary.
package cmd

import (
	"context"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/nlpgo"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// Root is the service entrypoint called by cmd/service.
func Root(ctx context.Context, _ []string) error {
	cfg, err := nlpgo.LoadConfig(ctx)
	if err != nil {
		return err
	}

	info := contexts.MustGetServiceInfo(ctx)
	info.Environment = cfg.Environment
	ctx = contexts.SetServiceInfo(ctx, *info)

	ctx, deps, err := nlpgo.NewDeps(ctx, cfg)
	if err != nil {
		return err
	}

	application := app.New(
		app.WithLogger(deps.Logger),
		app.WithChildProxy(deps.ChildProxy),
		app.WithChildManager(deps.Child),
	)

	return nlpgo.Serve(ctx, application, deps, cfg)
}

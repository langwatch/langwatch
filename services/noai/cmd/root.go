// Package cmd exposes the noai service entrypoint for the mono-binary.
package cmd

import (
	"context"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/noai"
)

// Root is the service entrypoint called by cmd/service.
func Root(ctx context.Context, _ []string) error {
	cfg, err := noai.LoadConfig(ctx)
	if err != nil {
		return err
	}

	info := contexts.MustGetServiceInfo(ctx)
	// ENVIRONMENT is optional for noai (dev-only service). Don't
	// overwrite the parent context's already-set value with "".
	if cfg.Environment != "" {
		info.Environment = cfg.Environment
	}
	ctx = contexts.SetServiceInfo(ctx, *info)

	ctx, deps, err := noai.NewDeps(ctx, cfg)
	if err != nil {
		return err
	}

	return noai.Serve(ctx, deps, cfg)
}

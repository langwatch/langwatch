// Package cmd exposes the lambdasim service entrypoint for haven's bundled simulator.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/lambdasim"
)

// Root is the service entrypoint.
func Root(ctx context.Context, _ []string) error {
	cfg := lambdasim.LoadConfig()

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-lambdasim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	clog.Get(ctx).Info("lambdasim faking the NLP Lambda fleet on this stack's nlpgo",
		zap.String("addr", cfg.Addr),
		zap.String("target", cfg.Target),
		zap.String("stack", cfg.Stack),
	)
	return lambdasim.NewServer(cfg).Serve(ctx)
}

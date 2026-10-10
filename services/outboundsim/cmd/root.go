// Package cmd exposes the outboundsim service entrypoint for haven's bundled simulator.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/outboundsim"
)

// Root is the service entrypoint.
func Root(ctx context.Context, _ []string) error {
	cfg := outboundsim.LoadConfig()

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-outboundsim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	clog.Get(ctx).Info("outboundsim catching Slack, webhook and SQS calls for the stack",
		zap.String("addr", cfg.Addr),
		zap.String("stack", cfg.Stack),
	)
	return outboundsim.NewServer(cfg).Serve(ctx)
}

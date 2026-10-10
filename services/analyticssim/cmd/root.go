// Package cmd exposes the analyticssim service entrypoint for haven's bundled simulator.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/analyticssim"
)

// Root is the service entrypoint.
func Root(ctx context.Context, _ []string) error {
	cfg := analyticssim.LoadConfig()

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-analyticssim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	clog.Get(ctx).Info("analyticssim catching PostHog and Customer.io calls for the stack",
		zap.String("addr", cfg.Addr),
		zap.String("stack", cfg.Stack),
	)
	return analyticssim.NewServer(cfg).Serve(ctx)
}

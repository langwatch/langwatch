// Package cmd exposes the telemetrysim service entrypoint for the sims mono-binary.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/telemetrysim"
)

// Root is the service entrypoint.
func Root(ctx context.Context, _ []string) error {
	cfg := telemetrysim.LoadConfig()

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-telemetrysim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	clog.Get(ctx).Info("telemetrysim ready to send OTLP to the stack",
		zap.String("addr", cfg.Addr),
		zap.String("stack", cfg.Stack),
	)
	return telemetrysim.NewServer(cfg).Serve(ctx)
}

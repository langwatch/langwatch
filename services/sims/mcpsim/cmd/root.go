// Package cmd exposes the mcpsim service entrypoint for the sims mono-binary.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/sims/mcpsim"
)

// Root is the service entrypoint.
// no-test: entrypoint wiring; mcpsim's tests cover the server it starts, combined_dev_test.go its registration.
func Root(ctx context.Context, _ []string) error {
	cfg := mcpsim.LoadConfig()

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-mcpsim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	clog.Get(ctx).Info("mcpsim ready to drive the hosted MCP endpoint",
		zap.String("addr", cfg.Addr),
		zap.String("stack", cfg.Stack),
		zap.String("endpoint", cfg.Endpoint),
	)
	return mcpsim.NewServer(cfg).Serve(ctx)
}

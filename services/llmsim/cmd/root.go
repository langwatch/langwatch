// Package cmd exposes the llmsim service entrypoint for haven's bundled simulator.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/llmsim"
)

// Root is the service entrypoint.
func Root(ctx context.Context, _ []string) error {
	cfg := llmsim.LoadConfig()

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-llmsim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	clog.Get(ctx).Info("llmsim answering LLM provider calls for the stack",
		zap.String("addr", cfg.Addr),
		zap.String("stack", cfg.Stack),
	)
	return llmsim.NewServer(cfg).Serve(ctx)
}

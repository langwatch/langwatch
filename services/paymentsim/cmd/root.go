// Package cmd exposes the paymentsim service entrypoint for the combined binary and haven.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/paymentsim"
)

// Root is the service entrypoint.
func Root(ctx context.Context, _ []string) error {
	cfg := paymentsim.LoadConfig()

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-paymentsim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	server, err := paymentsim.NewServer(cfg)
	if err != nil {
		return err
	}
	clog.Get(ctx).Info("paymentsim answering Stripe calls for the stack",
		zap.String("addr", cfg.Addr),
		zap.String("stack", cfg.Stack),
		zap.String("webhook", cfg.WebhookURL),
	)
	return server.Serve(ctx)
}

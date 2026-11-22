// Package cmd exposes the githubsim service entrypoint for haven's bundled simulator.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/sims/githubsim"
)

// Root is the service entrypoint.
func Root(ctx context.Context, _ []string) error {
	cfg := githubsim.LoadConfig()

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-githubsim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	clog.Get(ctx).Info("githubsim faking GitHub for this stack",
		zap.String("addr", cfg.Addr),
		zap.String("webhookUrl", cfg.WebhookURL),
		zap.String("stack", cfg.Stack),
	)
	return githubsim.NewServer(cfg).Serve(ctx)
}

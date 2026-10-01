// Package cmd exposes the storagesim service entrypoint for haven's bundled simulator.
package cmd

import (
	"context"
	"strings"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/storagesim"
)

// Root is the service entrypoint.
func Root(ctx context.Context, _ []string) error {
	cfg := storagesim.LoadConfig()

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-storagesim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	server, err := storagesim.NewServer(cfg)
	if err != nil {
		return err
	}
	clog.Get(ctx).Info("storagesim serving S3 objects for the stack",
		zap.String("addr", cfg.Addr),
		zap.String("dataDir", cfg.DataDir),
		zap.String("corsOrigins", strings.Join(cfg.CORSOrigins, ",")),
	)
	return server.Serve(ctx)
}

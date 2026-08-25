// Package cmd exposes the idpsim service entrypoint for the mono-binary.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/idpsim"
)

// Root is the service entrypoint called by cmd/service.
func Root(ctx context.Context, _ []string) error {
	cfg, err := idpsim.LoadConfig()
	if err != nil {
		return err
	}

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-idpsim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	server, err := idpsim.NewServer(cfg)
	if err != nil {
		return err
	}
	clog.Get(ctx).Info("idpsim serving simulated identity providers",
		zap.String("addr", cfg.Addr),
		zap.String("baseUrl", cfg.BaseURL),
		zap.Int("tenants", cfg.Tenants),
		zap.String("dnsAddr", cfg.DNSAddr),
	)
	return server.Serve(ctx)
}

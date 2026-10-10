// Package cmd exposes the idpsim service entrypoint for the mono-binary.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/idpsim"
)

// Options are the host's overrides, as for aigateway: the combined dev process
// hands Addr in because it cannot share SERVER_ADDR. Empty keeps SERVER_ADDR.
type Options struct {
	Addr string
}

// Root is the service entrypoint called by cmd/service.
func Root(ctx context.Context, _ []string) error {
	return Run(ctx, Options{})
}

// Run boots idpsim with the host's overrides applied.
func Run(ctx context.Context, overrides Options) error {
	cfg, err := idpsim.LoadConfig()
	if overrides.Addr != "" {
		cfg, err = idpsim.LoadConfigAt(overrides.Addr)
	}
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

// Package cmd exposes the mailsim service entrypoint for the mono-binary.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/mailsim"
)

// Root is the service entrypoint called by cmd/service.
func Root(ctx context.Context, _ []string) error {
	cfg, err := mailsim.LoadConfig()
	if err != nil {
		return err
	}

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-mailsim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	server, err := mailsim.NewServer(cfg)
	if err != nil {
		return err
	}
	clog.Get(ctx).Info("mailsim catching mail for the stack",
		zap.String("httpAddr", cfg.HTTPAddr),
		zap.String("smtpAddr", cfg.SMTPAddr),
		zap.String("baseUrl", cfg.BaseURL),
		zap.Int64("maxMessageBytes", cfg.MaxMessageBytes),
	)
	return server.Serve(ctx)
}

// Package cmd exposes the voicesim service entrypoint for haven's bundled simulator.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/voicesim"
)

// Root is the service entrypoint.
func Root(ctx context.Context, _ []string) error {
	cfg := voicesim.LoadConfig()

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-voicesim"
	ctx = contexts.SetServiceInfo(ctx, *info)

	clog.Get(ctx).Info("voicesim faking ElevenLabs ConvAI and OpenAI audio for the stack",
		zap.String("addr", cfg.Addr),
		zap.String("stack", cfg.Stack),
	)
	return voicesim.NewServer(cfg).Serve(ctx)
}

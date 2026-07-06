// Package cmd exposes the langy-agent service entrypoint for the
// mono-binary (cmd/service). Mirrors the aigateway / nlpgo pattern.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	langyagent "github.com/langwatch/langwatch/services/langy-agent"
)

// Root is the service entrypoint called by cmd/service. It loads env-driven
// config, then hands off to Serve which blocks until shutdown.
//
// Errors returned here cause `service langy-agent` to exit non-zero —
// missing LANGY_INTERNAL_SECRET, an unparseable PORT, etc. fail fast at
// container start rather than at first traffic.
func Root(ctx context.Context, _ []string) error {
	log := clog.Get(ctx)
	cfg, err := langyagent.LoadConfig(ctx)
	if err != nil {
		log.Error("load config failed", zap.Error(err))
		return err
	}
	return langyagent.Serve(ctx, cfg, log)
}

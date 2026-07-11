// Command haven is thuishaven — LangWatch's local-dev orchestrator ("home port").
// It is installable with `go install github.com/langwatch/langwatch/cmd/haven`.
package main

import (
	"context"
	"os"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd"
)

// Version is overridden via ldflags at build time.
var Version = "dev"

func main() {
	ctx := context.Background()
	logger := clog.New(ctx, clog.Config{Level: "info"})
	if err := cmd.Root(ctx, logger, Version, os.Args[1:]); err != nil {
		os.Exit(1)
	}
}

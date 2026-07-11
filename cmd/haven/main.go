// Command haven is thuishaven — LangWatch's local-dev orchestrator ("home port").
// It is installable with `go install github.com/langwatch/langwatch/cmd/haven`.
package main

import (
	"context"
	"fmt"
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
		// cmd.Root's unknown-command path already prints its own message
		// before returning; this is still the one place that reports every
		// other failure instead of exiting silently.
		fmt.Fprintln(os.Stderr, "haven:", err)
		os.Exit(1)
	}
}

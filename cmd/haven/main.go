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
		// The one place every failure is reported; its exit code says what
		// went wrong (64 usage, 65 not running, 66 timeout, 67 gate) or is a
		// wrapped command's own (ADR-064, amendment 2026-10-10).
		fmt.Fprintln(os.Stderr, "haven:", err)
		os.Exit(cmd.ExitCode(err))
	}
}

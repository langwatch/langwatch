// Command service is the LangWatch mono-binary that dispatches to individual
// services based on the first CLI argument (e.g. `service aigateway`).
package main

import (
	"context"
	"fmt"
	"os"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	aigateway "github.com/langwatch/langwatch/services/aigateway/cmd"
	nlpgo "github.com/langwatch/langwatch/services/nlpgo/cmd"
)

// Version is set via ldflags at build time.
var Version = "dev"

// ServiceBoot is the entrypoint signature each service must implement.
type ServiceBoot func(ctx context.Context, args []string) error

var services = map[string]ServiceBoot{
	"aigateway": aigateway.Root,
	"nlpgo":     nlpgo.Root,
}

func main() {
	os.Exit(run(os.Args))
}

func run(args []string) int {
	ctx := context.Background()
	logger := clog.New(ctx, clog.Config{Level: "info"})
	ctx = clog.Set(ctx, logger)
	defer clog.HandlePanic(ctx, false)

	args = args[1:]
	if len(args) == 0 {
		fmt.Fprintf(os.Stderr, "usage: service <command> [args...]\navailable: ")
		for name := range services {
			fmt.Fprintf(os.Stderr, "%s ", name)
		}
		fmt.Fprintln(os.Stderr)
		return 1
	}

	cmd := args[0]
	args = args[1:]

	if cmd == "--version" || cmd == "-v" || cmd == "version" {
		fmt.Println(Version)
		return 0
	}

	fn, ok := services[cmd]
	if !ok {
		logger.Error("unknown service", zap.String("command", cmd))
		return 1
	}

	ctx = contexts.SetServiceInfo(ctx, contexts.ServiceInfo{
		Service:     cmd,
		Version:     Version,
		Environment: os.Getenv("ENVIRONMENT"),
	})

	if err := fn(ctx, args); err != nil {
		logger.Error("service exited with error", zap.String("service", cmd), zap.Error(err))
		return 1
	}

	return 0
}

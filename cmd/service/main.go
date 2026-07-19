// Command service is the LangWatch mono-binary that dispatches to individual
// services based on the first CLI argument (e.g. `service aigateway`).
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	aigateway "github.com/langwatch/langwatch/services/aigateway/cmd"
	langyagent "github.com/langwatch/langwatch/services/langyagent/cmd"
	nlpgo "github.com/langwatch/langwatch/services/nlpgo/cmd"
)

// Version is set via ldflags at build time.
var Version = "dev"

// serviceTelemetryName is the canonical service.name a mono-binary subcommand
// reports on every signal — the OTel resource (traces/logs/metrics via
// otelsetup) and the per-line `service` field (pkg/clog) both read it from
// ServiceInfo.Service. Uniform "langwatch-service-<cmd>" so the Go data-plane
// services read consistently in Grafana:
//
//	langwatch-service-aigateway · langwatch-service-langyagent · langwatch-service-nlpgo
//
// alongside the app (langwatch-app) and the sandboxed Langy worker
// (langwatch-service-langyworker, set in langyagent/adapters/opencode). An
// explicit OTEL_SERVICE_NAME wins, matching the app's own precedence
// (instrumentation.node.ts) and the official OTel convention.
func serviceTelemetryName(cmd string) string {
	if name := os.Getenv("OTEL_SERVICE_NAME"); name != "" {
		return name
	}
	return "langwatch-service-" + cmd
}

// ServiceBoot is the entrypoint signature each service must implement.
type ServiceBoot func(ctx context.Context, args []string) error

var services = map[string]ServiceBoot{
	"aigateway":  aigateway.Root,
	"langyagent": langyagent.Root,
	"nlpgo":      nlpgo.Root,
}

func main() {
	// A langwatch platform process must never carry the langwatch SDK's own
	// LANGWATCH_API_KEY. With it set, the platform's OTel/SDK bootstrap exports the
	// platform's own operational telemetry into its own trace ingest — a
	// self-referencing feedback loop (every ingested span does more work that emits
	// more spans). Refuse to boot rather than silently self-reference.
	if os.Getenv("LANGWATCH_API_KEY") != "" {
		panic("LANGWATCH_API_KEY must not be set on a langwatch platform process — it makes " +
			"the platform self-reference its own trace ingest (a feedback loop).")
	}
	os.Exit(run(os.Args))
}

func run(args []string) (code int) {
	ctx := context.Background()
	logger := clog.New(ctx, clog.Config{Level: "info"})
	ctx = clog.Set(ctx, logger)
	// A panic on the main goroutine must exit non-zero: recover here (so the
	// process logs a clean panic instead of a raw runtime crash) and set the
	// named return to 1 so os.Exit reflects the failure to the orchestrator.
	defer func() {
		if r := recover(); r != nil {
			clog.LogPanic(ctx, r)
			// Ship buffered telemetry before the process exits — a fatal panic
			// otherwise loses the BatchSpanProcessor's queued spans/metrics.
			// Bounded so a stuck collector can't hang the exit. SIGKILL / OOM
			// remain uncatchable; this covers the fatal panic the process DID
			// observe.
			flushCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			otelsetup.ForceFlushGlobal(flushCtx)
			cancel()
			code = 1
		}
	}()

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
		Service:     serviceTelemetryName(cmd),
		Version:     Version,
		Environment: os.Getenv("ENVIRONMENT"),
	})

	if err := fn(ctx, args); err != nil {
		logger.Error("service exited with error", zap.String("service", cmd), zap.Error(err))
		return 1
	}

	return 0
}

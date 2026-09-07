package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	aigateway "github.com/langwatch/langwatch/services/aigateway/cmd"
	nlpgo "github.com/langwatch/langwatch/services/nlpgo/cmd"
)

// combinedCommand is the subcommand name: `service combined`.
const combinedCommand = "combined"

// The address each hosted service binds when the combined process runs it.
// SERVER_ADDR cannot answer here — one process, two listeners — so each gets
// a name of its own. Unset means "the service's own default", exactly as a
// standalone run resolves it.
const (
	combinedGatewayAddrEnv = "LANGWATCH_GO_AIGATEWAY_ADDR"
	combinedNLPAddrEnv     = "LANGWATCH_GO_NLPGO_ADDR"
)

// combinedService is one service the combined process hosts: the telemetry
// identity it reports under, and the boot it runs.
type combinedService struct {
	// Name is the CLI spelling — what `service combined <name> ...` selects.
	Name string
	// Telemetry is the service.name every signal carries, identical to the
	// name the same service reports when it runs on its own.
	Telemetry string
	// AddrEnv is the variable naming the port this instance binds.
	AddrEnv string
	// Run boots the service and returns when its context is cancelled.
	Run func(ctx context.Context, addr string) error
}

// combinedServices is what `service combined` can host, in start order.
//
// langyagent is deliberately absent. It is not a request/response server the
// way these two are: it spawns one sandboxed worker subprocess per
// conversation and owns their lifetimes, so a restart of the combined process
// on a source change would take live conversations with it. It keeps its own
// lane, started and stopped on its own schedule.
var combinedServices = []combinedService{
	{
		Name:      "aigateway",
		Telemetry: "langwatch-service-aigateway",
		AddrEnv:   combinedGatewayAddrEnv,
		Run: func(ctx context.Context, addr string) error {
			return aigateway.Run(ctx, aigateway.Options{Addr: addr})
		},
	},
	{
		Name:      "nlpgo",
		Telemetry: "langwatch-service-nlp",
		AddrEnv:   combinedNLPAddrEnv,
		Run: func(ctx context.Context, addr string) error {
			return nlpgo.Run(ctx, nlpgo.Options{Addr: addr})
		},
	},
}

// selectCombinedServices resolves the names a caller asked for. No names means
// every service; an unknown name is refused rather than silently dropped,
// because a stack that quietly hosts one fewer service looks identical to a
// healthy one until something calls the missing port.
func selectCombinedServices(names []string) ([]combinedService, error) {
	if len(names) == 0 {
		return combinedServices, nil
	}
	var known []string
	for _, svc := range combinedServices {
		known = append(known, svc.Name)
	}
	var out []combinedService
	for _, name := range names {
		found := false
		for _, svc := range combinedServices {
			if svc.Name != name {
				continue
			}
			out = append(out, svc)
			found = true
			break
		}
		if !found {
			return nil, fmt.Errorf("service combined: unknown service %q (available: %s)", name, strings.Join(known, ", "))
		}
	}
	return out, nil
}

// combinedRoot hosts the Go data-plane services in one development process.
//
// Every service keeps its own configuration, its own dependencies and its own
// telemetry identity — the only thing they share is the process, its signal
// handling and its stdout. The first service to fail cancels the group, so a
// half-running combined process is not a state this can reach.
func combinedRoot(ctx context.Context, args []string) error {
	selected, err := selectCombinedServices(args)
	if err != nil {
		return err
	}

	base := contexts.MustGetServiceInfo(ctx)
	group, groupCtx := errgroup.WithContext(ctx)
	for _, svc := range selected {
		info := *base
		info.Service = svc.Telemetry
		serviceCtx := contexts.SetServiceInfo(groupCtx, info)
		logger := clog.New(serviceCtx, clog.Config{Level: "info"})
		serviceCtx = clog.Set(serviceCtx, logger)
		addr := os.Getenv(svc.AddrEnv)
		logger.Info("combined_service_starting",
			zap.String("service", svc.Name),
			zap.String("addr", addr),
		)
		group.Go(func() error {
			if err := svc.Run(serviceCtx, addr); err != nil {
				return fmt.Errorf("%s: %w", svc.Name, err)
			}
			return nil
		})
	}
	return group.Wait()
}

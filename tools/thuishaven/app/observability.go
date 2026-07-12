package app

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// RunObservability dispatches the `haven observability <sub>` group: manual
// control over the shared LGTM stack every worktree exports to.
func (o *Orchestrator) RunObservability(ctx context.Context, args []string) error {
	sub := "status"
	if len(args) > 0 {
		sub = args[0]
	}
	switch sub {
	case "status":
		return o.observabilityStatus(ctx)
	case "up":
		return o.observabilityUp(ctx)
	case "down":
		return o.observabilityDown(ctx)
	default:
		return fmt.Errorf("unknown `haven observability` subcommand %q (want status|up|down)", sub)
	}
}

// observabilityUp starts the stack and routes its hostname. Stacks that are
// already running keep exporting wherever they were pointed when they booted —
// the overlay is written at `up` — so say so rather than let someone wonder why
// Grafana is empty.
func (o *Orchestrator) observabilityUp(ctx context.Context) error {
	endpoints, err := o.obs.Ensure(ctx)
	if err != nil {
		return err
	}
	o.routeObservability()

	fmt.Printf("observability stack up\n")
	fmt.Printf("  grafana   : %s  (anonymous Admin, or admin/admin)\n", endpoints.GrafanaURL())
	fmt.Printf("  otlp      : %s\n", endpoints.OTLPHTTPURL())
	if url := o.sharedURL(domain.ObservabilityService); url != "" {
		fmt.Printf("  hostname  : %s\n", url)
	}
	if n := len(o.store.Stacks()); n > 0 {
		fmt.Printf("\n%d stack(s) are already running and were wired before this existed.\n", n)
		fmt.Printf("Restart them (`pnpm dev`) to export into it.\n")
	}
	fmt.Printf("\nNext: make observability-connect   # mint a Grafana token + configure gcx\n")
	return nil
}

// observabilityDown removes the stack. Its telemetry goes with it — there is no
// volume, by design.
func (o *Orchestrator) observabilityDown(ctx context.Context) error {
	if err := o.obs.Stop(ctx); err != nil {
		return err
	}
	o.proxy.Remove(domain.ObservabilityService, "")
	fmt.Println("observability stack down (collected telemetry discarded)")
	return nil
}

func (o *Orchestrator) observabilityStatus(ctx context.Context) error {
	ok, detail := o.obs.Health(ctx)
	state := "down"
	if ok {
		state = "up"
	}
	fmt.Printf("observability: %s (%s)\n", state, detail)
	if ok {
		if url := o.sharedURL(domain.ObservabilityService); url != "" {
			fmt.Printf("  hostname : %s\n", url)
		}
	}
	return nil
}

// linkObservability records the collector's port on the stack — which is what
// makes OverlayEnv emit the OTel vars — and routes the shared hostname. It is
// called during `up`, before the overlay is written.
//
// The stack is only STARTED here when the contributor asked for it
// (LANGWATCH_HAVEN_OBS=1); otherwise haven merely links to one that is already
// running. Booting a 2 GiB telemetry stack behind everyone's back on every
// `pnpm dev` is not a default anyone would choose.
func (o *Orchestrator) linkObservability(ctx context.Context, st *domain.Stack) {
	if o.obs == nil {
		return
	}
	if o.cfg.ShouldStartObservability {
		if _, err := o.obs.Ensure(ctx); err != nil {
			o.log.Warn("could not start the observability stack — continuing without it", zap.Error(err))
			return
		}
	} else if !o.obs.IsRunning(ctx) {
		return
	}
	st.ObservabilityOTLPPort = o.obs.Endpoints().OTLPHTTPPort
	st.ObservabilityGrafanaPort = o.obs.Endpoints().GrafanaPort
	st.ObservabilityConsoleLevel = o.cfg.ObservabilityConsoleLevel
	o.routeObservability()
}

// routeObservability points observability.langwatch.localhost at Grafana.
func (o *Orchestrator) routeObservability() {
	if o.obs == nil {
		return
	}
	port := o.obs.Endpoints().GrafanaPort
	if port == 0 {
		return
	}
	if err := o.proxy.Register(domain.ObservabilityService, "", port); err != nil {
		o.log.Warn("could not route the observability hostname", zap.Error(err))
	}
}

// sharedURL builds a shared surface's browser URL (empty when the proxy is down).
func (o *Orchestrator) sharedURL(service string) string {
	if !o.proxy.Running() {
		return ""
	}
	scheme, port := o.proxy.Endpoint()
	return o.cfg.Naming.URL(service, "", scheme, port)
}

package app

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// ObservabilityLogs streams the shared LGTM container's docker logs — the
// `haven logs obs` target, so the observability stack is a log target like
// any service.
func (o *Orchestrator) ObservabilityLogs(ctx context.Context, follow bool) error {
	// The native stack writes one log file per process instead of docker logs.
	if native, ok := o.obs.(interface{ LogFiles() []string }); ok {
		shell := "tail -n 200"
		if follow {
			shell += " -F"
		}
		for _, f := range native.LogFiles() {
			shell += " " + shellQuote(f)
		}
		return o.sup.RunOnce(ctx, "obs", o.cfg.RepoRoot, shell, nil)
	}
	if o.container == nil {
		return fmt.Errorf("no container runtime configured")
	}
	dockerHost, err := o.container.Ensure(ctx)
	if err != nil {
		return err
	}
	shell := "docker logs --tail 200 " + domain.ObservabilityContainer
	if follow {
		shell = "docker logs --tail 200 -f " + domain.ObservabilityContainer
	}
	return o.sup.RunOnce(ctx, "obs", o.cfg.RepoRoot, shell, []string{"DOCKER_HOST=" + dockerHost})
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
	if o.obs == nil || o.isObservabilityOff() {
		return // switched off in machine settings: no collector, no OTel vars
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
	st.ObservabilityPyroscopePort = o.obs.Endpoints().PyroscopePort
	st.ObservabilityGrafanaURL = o.sharedURL(domain.ObservabilityService)
	st.ObservabilityConsoleLevel = o.cfg.ObservabilityConsoleLevel
	o.routeObservability()
}

// routeObservability points observability.langwatch.localhost at Grafana.
func (o *Orchestrator) routeObservability() {
	if o.obs == nil {
		return
	}
	port := o.obs.Endpoints().GrafanaPort
	if port == 0 || o.routedTo(domain.ObservabilityService, port) {
		return
	}
	if err := o.proxy.Register(domain.ObservabilityService, "", port); err != nil {
		o.log.Warn("could not route the observability hostname", zap.Error(err))
	}
}

// routedTo reports whether the proxy's table already sends a shared hostname to
// port. The daemon re-routes observability every 10 s cycle, and each Register
// is a `node portless alias` spawn, so a route already in place is left alone.
func (o *Orchestrator) routedTo(service string, port int) bool {
	table, ok := o.proxy.(routeTable)
	if !ok {
		return false
	}
	routed, has := table.Routes()[o.cfg.Naming.Hostname(service, "")]
	return has && routed == port
}

// hasRoute reports whether a shared hostname may be in the proxy's table: true
// when the proxy keeps no table to ask, so a Remove is never skipped blind.
func (o *Orchestrator) hasRoute(service string) bool {
	table, ok := o.proxy.(routeTable)
	if !ok {
		return true
	}
	_, has := table.Routes()[o.cfg.Naming.Hostname(service, "")]
	return has
}

// sharedURL builds a shared surface's browser URL (empty when the proxy is down).
func (o *Orchestrator) sharedURL(service string) string {
	if !o.proxy.Running() {
		return ""
	}
	scheme, port := o.proxy.Endpoint()
	return o.cfg.Naming.URL(service, "", scheme, port)
}

package app

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

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

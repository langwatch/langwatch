package cmd

import (
	"strings"

	langyagent "github.com/langwatch/langwatch/services/langyagent"
	"github.com/langwatch/langwatch/services/langyagent/adapters/egress"
	"github.com/langwatch/langwatch/services/langyagent/telemetry"
)

// Manager owns the composed egress adapter (ADR-044 part 5). It holds the
// resolved scorer bounds (egressAdapterConfig) and the guard the pool consults,
// so PR4's egress ENFORCEMENT can swap in behind this seam — read/extend the
// config and replace the guard — without re-plumbing the composition root.
type Manager struct {
	egressAdapterConfig egress.Config
	egressGuard         egress.Guard
}

// EgressGuard is the per-worker egress seam the worker pool consults.
func (m *Manager) EgressGuard() egress.Guard { return m.egressGuard }

// EgressConfig exposes the resolved scorer bounds (the allowlist + thresholds).
// PR4 reads/extends these to tune enforcement against real flagged traffic.
func (m *Manager) EgressConfig() egress.Config { return m.egressAdapterConfig }

// startEgressAdapter builds the OBSERVE-ONLY egress adapter from config: a
// monitoring guard that flags (never blocks) suspicious egress. PR4 slots
// enforcement in behind the same Manager seam. The telemetry handle is accepted
// so PR4 can hang enforcement counters off the same meter without changing the
// signature.
func startEgressAdapter(cfg langyagent.Config, _ *telemetry.Telemetry) *Manager {
	ec := egress.DefaultConfig()
	if hosts := parseHostList(cfg.EgressAllowedHosts); len(hosts) > 0 {
		ec.AllowedHosts = hosts
	}
	return &Manager{
		egressAdapterConfig: ec,
		egressGuard:         egress.NewMonitoringGuard(ec),
	}
}

func parseHostList(raw string) []string {
	var out []string
	for _, h := range strings.Split(raw, ",") {
		if h = strings.TrimSpace(h); h != "" {
			out = append(out, h)
		}
	}
	return out
}

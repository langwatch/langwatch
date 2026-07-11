package cmd

import (
	"strings"

	"go.uber.org/zap"

	langyagent "github.com/langwatch/langwatch/services/langyagent"
	"github.com/langwatch/langwatch/services/langyagent/adapters/egress"
)

// Manager owns the composed egress guard (ADR-043 enforcement). It holds the
// per-worker egress guard the pool consults, built from the operator egress
// posture in Config. Keeping it behind this seam lets the composition root wire
// the pool without knowing which guard implementation is in force.
type Manager struct {
	egressGuard egress.Guard
}

// EgressGuard is the per-worker egress seam the worker pool consults.
func (m *Manager) EgressGuard() egress.Guard { return m.egressGuard }

// startEgressAdapter builds the ADR-043 ENFORCING egress guard from config: a
// per-worker outbound forward proxy that require-TLS / throttles / applies the
// operator floor ∪ per-project allow-list / SNI-cross-checks every CONNECT,
// monitor-first. The stock posture is monitor-only (no floor enforcement and no
// per-project customer list) until an operator flips EgressEnforceFloor or a
// customer sets an allow-list — see the Config defaults and ADR-043.
func startEgressAdapter(cfg langyagent.Config, logger *zap.Logger) *Manager {
	return &Manager{
		egressGuard: egress.NewEnforcingGuard(egress.EnforcingConfig{
			Floor:         parseHostList(cfg.EgressFqdnFloor),
			RequireTLS:    cfg.EgressRequireTLS,
			EnforceFloor:  cfg.EgressEnforceFloor,
			SNICrossCheck: cfg.EgressSNICrossCheck,
			Logger:        logger,
		}),
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

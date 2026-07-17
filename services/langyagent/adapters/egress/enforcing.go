package egress

import (
	"context"
	"sync"

	"go.uber.org/zap"
)

// EnforcingConfig is the operator-owned egress posture (ADR-043), resolved once
// from the manager config and shared by every worker. The per-project customer
// allow-list is NOT here — it rides each worker's credentials envelope and
// arrives via WorkerContext.EgressAllowlist.
type EnforcingConfig struct {
	// Floor is the always-allowed structural set (github / gateway / control
	// plane). Additive to each project's customer allow-list; never a ceiling by
	// itself unless EnforceFloor is on.
	Floor []string
	// RequireTLS refuses cleartext forwards and non-:443 CONNECTs (rung 1a).
	RequireTLS bool
	// EnforceFloor makes the floor a hard ceiling for projects that set no
	// allow-list (rung 3 lever). Off by default keeps the stock posture
	// monitor-only.
	EnforceFloor bool
	// SNICrossCheck peeks the TLS ClientHello SNI as an anti-domain-fronting
	// cross-check of the CONNECT authority.
	SNICrossCheck bool
	// Logger is the pod logger the default rung-0 monitor writes decisions to.
	Logger *zap.Logger
}

// EnforcingGuard is the ADR-043 enforcement Guard. PrepareWorker stands up a
// per-worker outbound forward proxy (egressAdapter) bound to an ephemeral
// loopback port and returns that port so the pool points the worker's
// HTTPS_PROXY at it; the proxy enforces require-TLS / throttle / floor ∪
// allow-list / SNI-cross-check on every CONNECT, monitor-first. The guard is
// stateless per worker — teardown rides on the returned WorkerEgress handle
// (stored on the Worker, Closed on every teardown path), so a recycle can never
// leave a stale proxy bound to a conversation's port.
type EnforcingGuard struct {
	cfg EnforcingConfig
	log *zap.Logger
}

// NewEnforcingGuard builds the enforcement guard from the operator config.
func NewEnforcingGuard(cfg EnforcingConfig) *EnforcingGuard {
	log := cfg.Logger
	if log == nil {
		log = zap.NewNop()
	}
	return &EnforcingGuard{cfg: cfg, log: log}
}

// PrepareWorker binds this worker's forward proxy and returns its loopback port.
// A bind failure fails the spawn closed (a worker that cannot get its enforced
// egress path must not start with unenforced egress).
func (g *EnforcingGuard) PrepareWorker(_ context.Context, w WorkerContext) (WorkerEgress, error) {
	adapter, err := startEgressAdapter(0, egressAdapterConfig{
		conversationID: w.ConversationID,
		policy: egressPolicy{
			allowlist:    w.EgressAllowlist,
			floor:        g.cfg.Floor,
			enforceFloor: g.cfg.EnforceFloor,
		},
		throttle:      defaultThrottleConfig(),
		requireTLS:    g.cfg.RequireTLS,
		sniCrossCheck: g.cfg.SNICrossCheck,
		log:           g.log,
	})
	if err != nil {
		return WorkerEgress{}, err
	}
	var once sync.Once
	return WorkerEgress{
		ProxyPort: adapter.port,
		closeFn:   func() { once.Do(adapter.shutdown) },
	}, nil
}

var _ Guard = (*EnforcingGuard)(nil)

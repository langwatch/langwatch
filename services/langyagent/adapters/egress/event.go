package egress

import "go.uber.org/zap"

// egressDecision is the verb attached to every observed outbound flow. Rung 0
// (ADR-043) makes every enforcement action ALSO a monitored event, so a
// deny/throttle is a monitored deny/throttle — the same event with a different
// verb. The control plane never sees these; they are pod-local telemetry.
type egressDecision string

const (
	// egressAllowedFloor: destination is on the always-on operator FQDN floor
	// (github / gateway / control plane). Allowed regardless of customer list.
	egressAllowedFloor egressDecision = "allowed_floor"
	// egressAllowedMonitor: no customer allow-list is set and the floor is not
	// enforced, so the flow is allowed but flagged (rung 2 default — watch, do
	// not block).
	egressAllowedMonitor egressDecision = "allowed_monitor"
	// egressAllowedListed: destination is on the customer's allow-list.
	egressAllowedListed egressDecision = "allowed_listed"
	// egressThrottled: destination was allowed but the flow shape (connection
	// burst or byte volume) tripped the per-destination soft throttle.
	egressThrottled egressDecision = "throttled"
	// egressDenied: an allow-list is in force and the destination is not on it
	// (nor on the floor). Bytes never leave the pod.
	egressDenied egressDecision = "denied"
	// egressDeniedCleartext: a cleartext (non-CONNECT / non-TLS) forward to an
	// external host — refused by rung 1a require-TLS.
	egressDeniedCleartext egressDecision = "denied_cleartext"
	// egressDeniedSNIMismatch: the TLS ClientHello SNI did not match the CONNECT
	// authority the decision was made against (domain-fronting attempt).
	egressDeniedSNIMismatch    egressDecision = "denied_sni_mismatch"
	egressDeniedPrivateAddress egressDecision = "denied_private_address"
)

// blocked reports whether a decision denied the flow (no bytes reach the
// destination). Used at the call site to choose 403 vs. tunnel.
func (d egressDecision) blocked() bool {
	switch d {
	case egressDenied, egressDeniedCleartext, egressDeniedSNIMismatch, egressDeniedPrivateAddress:
		return true
	default:
		return false
	}
}

// egressEvent is one observed outbound flow, attributed to the worker's
// conversation. Bytes is populated on flow completion for allowed tunnels.
type egressEvent struct {
	ConversationID string
	Host           string
	Port           string
	Decision       egressDecision
	Reason         string
	Bytes          int64
}

// egressMonitor is the rung-0 flag sink (ADR-043). The enforcing adapter calls
// record() on every per-CONNECT decision so enforcement and monitoring are the
// same event. The default is logEgressMonitor (pod log); an operator wiring a
// richer attributed-telemetry sink injects it at NewEnforcingGuard time.
type egressMonitor interface {
	record(egressEvent)
}

// logEgressMonitor is the default monitor: it emits every decision to the pod
// log, so "every enforcement action is a monitored event" holds out of the box.
type logEgressMonitor struct {
	log *zap.Logger
}

// newLogEgressMonitor returns the default egress monitor, which reports each
// decision to the service log. It is the fallback when no richer sink is wired.
func newLogEgressMonitor(log *zap.Logger) *logEgressMonitor {
	return &logEgressMonitor{log: log}
}

// record emits one structured line per egress decision — allowed or refused —
// so a tenant's outbound attempts stay auditable. Host and port are recorded;
// request contents and credentials deliberately are not. A nil monitor or nil
// logger is a no-op so callers never have to guard the call site.
func (m *logEgressMonitor) record(e egressEvent) {
	if m == nil || m.log == nil {
		return
	}
	m.log.Info("langy egress",
		zap.String("conversation", e.ConversationID),
		zap.String("host", e.Host),
		zap.String("port", e.Port),
		zap.String("decision", string(e.Decision)),
		zap.String("reason", e.Reason),
		zap.Int64("bytes", e.Bytes),
	)
}

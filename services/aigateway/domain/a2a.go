package domain

import (
	"errors"
	"slices"
)

// A2ATarget is an A2A agent registered for a project, which callers in that
// project reach through the gateway at /a2a/{Name}.
// Spec: specs/ai-gateway/a2a-proxy.feature.
type A2ATarget struct {
	Name string
	// AgentName is the target's agent name, recorded as gen_ai.agent.name.
	AgentName string
	// UpstreamURL is the base URL the target serves A2A on.
	UpstreamURL string
	// CardURL is where the target's Agent Card lives. Empty means
	// UpstreamURL + /.well-known/agent-card.json.
	CardURL string
	// UpstreamHeaders are sent upstream on every call, e.g. the target's own
	// bearer token. The caller's virtual key never goes upstream.
	UpstreamHeaders map[string]string
	// Blocked refuses every caller: the kill switch for this target.
	Blocked     bool
	BlockReason string
	// Policy is the allow list. Nil admits any key of the project; a non-nil
	// policy denies every key it does not list.
	Policy *A2APolicy
}

// A2APolicy lists the virtual keys allowed to call one target.
type A2APolicy struct {
	AllowedVirtualKeyIDs []string
}

// A2ADecision is why a call to a target was admitted or refused.
type A2ADecision string

// Decisions; each refusal doubles as the reason on the wire.
const (
	A2AAllowed          A2ADecision = "allowed"
	A2ACallerNotAllowed A2ADecision = "a2a_caller_not_allowed"
	A2ATargetBlocked    A2ADecision = "a2a_target_blocked"
)

// Admit decides whether the virtual key may call the target.
func (t A2ATarget) Admit(virtualKeyID string) A2ADecision {
	if t.Blocked {
		return A2ATargetBlocked
	}
	if t.Policy != nil && !slices.Contains(t.Policy.AllowedVirtualKeyIDs, virtualKeyID) {
		return A2ACallerNotAllowed
	}
	return A2AAllowed
}

// ErrA2ATargetNotFound is returned by a registry that knows no such target
// for the caller's project.
var ErrA2ATargetNotFound = errors.New("a2a target not found")

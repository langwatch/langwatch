package app

import "sort"

// Capability composes a side-concern into a worker's runtime environment — the
// credentials + env a coding agent needs beyond base LLM access. GitHub (opening
// PRs as the requesting user) is the first implementation; a just-in-time secrets
// broker (the parked credential crucible) is the intended next. The composition
// layer builds the set from the turn's Credentials and hands it to the agent's
// Spawn, which folds each Contribute() into the subprocess env — so the env
// assembly never special-cases any one capability, and a new one is a new
// implementation rather than a new branch.
//
// The capability set ALSO drives the worker credential signature (SignatureKeys →
// domain.SignatureOf): a capability that is active for one worker but not another
// forces a respawn, because a worker keeps its secret in the subprocess env and
// must not be reused for a turn that lacks it. That used to be a github-specific
// bool hard-coded in domain.SignatureOf; folding it in here means a new capability
// affects reuse automatically, with no second place to update.
type Capability interface {
	// Name identifies the capability in logs and telemetry.
	Name() string
	// Contribute returns the env vars this capability injects into the worker
	// process, or nil when it is not active for this worker.
	Contribute() []string
	// SignatureKey returns a stable identity folded into the worker credential
	// signature when the capability is ACTIVE, or "" when it is inert. It MUST be
	// in lockstep with Contribute: a capability that contributes env returns a
	// non-empty key, one that contributes nothing returns "". The key encodes
	// presence, never the secret itself, so it is safe to compute on the read-only
	// probe path (which knows only whether a capability would be present).
	SignatureKey() string
}

// SignatureKeys is the capability set's contribution to the worker credential
// signature: the sorted keys of the ACTIVE capabilities in caps (an inert
// capability's "" is dropped). Two workers whose active keys differ cannot be
// reused for one another. Feed the result to domain.SignatureOf.
func SignatureKeys(caps []Capability) []string {
	keys := make([]string, 0, len(caps))
	for _, c := range caps {
		if k := c.SignatureKey(); k != "" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}

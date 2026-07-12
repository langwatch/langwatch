package app

// Capability composes a side-concern into a worker's runtime environment — the
// credentials + env a coding agent needs beyond base LLM access. GitHub (opening
// PRs as the requesting user) is the first implementation; a just-in-time secrets
// broker (the parked credential crucible) is the intended next. The pool builds
// the set from the turn's Credentials and hands it to the agent's Spawn, which
// folds each Contribute() into the subprocess env — so the env assembly never
// special-cases any one capability, and a new one is a new implementation rather
// than a new branch.
//
// NOTE: the worker CREDENTIAL SIGNATURE (domain.CredentialSignature, which forces
// a respawn when a capability set changes — e.g. a GitHub token added or removed)
// still lives in domain.SignatureOf today. Unifying it with Capability is a
// follow-up: the signature is also computed on the read-only probe path and must
// stay in lockstep with the control plane's probe sentinel, so moving it is a
// contract change, not a local refactor.
type Capability interface {
	// Name identifies the capability in logs and telemetry.
	Name() string
	// Contribute returns the env vars this capability injects into the worker
	// process, or nil when it is not active for this worker.
	Contribute() []string
}

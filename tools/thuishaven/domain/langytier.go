package domain

import "strings"

// LangyTier is the local isolation posture haven runs the langyagent worker
// under. It is resolved once, before the stack is built, from two developer-set
// env flags and the machine itself (see ResolveLangyTier), and decides two things
// at once: WHERE the worker runs (inside the colima VM vs. as a bare host
// process) and which isolation runner it uses INSIDE (the ADR-033 per-worker UID
// sandbox vs. the unprivileged localunsafe runner).
//
// The three tiers are strictly ordered from safest to least safe. Production is
// never any of these — it always runs the sandboxed runner under gVisor; these
// exist only so a developer can trade isolation for convenience on their own box
// with eyes open.
type LangyTier int

const (
	// LangyTierSandboxed is the default and mirrors production: the worker runs in
	// a colima container (root, so setuid+chown work) with the ADR-033 per-worker
	// UID sandbox active, and the colima VM isolates the whole thing from the host.
	// A sibling worker cannot read another's plaintext credentials, and nothing the
	// agent does can touch the developer's real filesystem. Neither unsafe flag set.
	LangyTierSandboxed LangyTier = iota

	// LangyTierContainerUnsafe still runs the worker in the colima container — so
	// the host filesystem is still behind the VM boundary — but disables the
	// per-worker UID sandbox inside it (LANGY_UNSAFE_DEV_DISABLE_ISOLATION). Every
	// worker then shares one UID, so sibling isolation is gone; the host is still
	// protected. Simpler/faster than the setuid path when iterating. Selected by
	// LANGY_UNSAFE_CONTAINER.
	LangyTierContainerUnsafe

	// LangyTierHostUnsafe runs the worker as a bare process on the host with no VM
	// and no UID sandbox: the agent has the developer's own filesystem access. The
	// least safe tier, for when the worker genuinely must reach host paths. Selected
	// by LANGY_UNSAFE_HOST_ACCESS (which implies the container relaxation above), and
	// resolved for a development stack on a machine with no container runtime.
	LangyTierHostUnsafe
)

// LangyTierRequest is everything the tier is resolved from, gathered once
// before the stack is built. It is a request rather than an answer because the
// answer depends on the machine as well as the developer's flags: the tier is
// persisted on the stack, threaded into the overlay, the plan, restart and the
// reconcile guard, so it has to be settled before any of them see it.
type LangyTierRequest struct {
	// UnsafeContainer is LANGY_UNSAFE_CONTAINER: run in colima, UID sandbox off.
	UnsafeContainer bool
	// UnsafeHostAccess is LANGY_UNSAFE_HOST_ACCESS set to a truthy value: run the
	// worker as a bare host process.
	UnsafeHostAccess bool
	// HostAccessRefused is LANGY_UNSAFE_HOST_ACCESS set to a falsey value — an
	// explicit "never run this on my host", which turns the development fallback
	// below off again. Distinguished from unset on purpose: unset is an opinion
	// nobody has expressed, and only that one can be answered for the developer.
	HostAccessRefused bool
	// IsDevelopment is whether this stack is a development stack (see
	// IsDevelopmentEnvironment). Only a development stack may be dropped to the
	// host tier for the developer.
	IsDevelopment bool
	// ContainerRuntimeAvailable is whether a container runtime can be reached on
	// this machine at all. False means the container tiers cannot run, so the
	// choice is the host tier or no langyagent.
	ContainerRuntimeAvailable bool
}

// LangyHostFallbackNotice is the one line printed when the tier was chosen for
// the developer rather than asked for. It names the cause, the consequence and
// the way to refuse, because a quieter isolation posture than the one someone
// believes they have must never be inferred in silence.
const LangyHostFallbackNotice = "no container runtime; running langyagent on the host because this is a development stack; set LANGY_UNSAFE_HOST_ACCESS=0 to refuse"

// ResolveLangyTier maps a request to a tier, and to a notice when the tier was
// resolved from the machine rather than from a flag ("" when it was asked for).
//
// Host access is the strongest opt-in and implies the container relaxation, so
// it wins whenever set; otherwise the container-relaxation flag steps down one
// rung. With neither flag set, a development stack on a machine with no
// container runtime resolves to the host tier — the container tiers cannot run
// there, and the alternative is haven running no manager at all. Every other
// case is the sandboxed default: an explicit refusal, a machine that does have a
// runtime, and anything that is not a development stack all keep it.
func ResolveLangyTier(req LangyTierRequest) (tier LangyTier, notice string) {
	switch {
	case req.UnsafeHostAccess:
		return LangyTierHostUnsafe, ""
	case req.UnsafeContainer:
		return LangyTierContainerUnsafe, ""
	case req.HostAccessRefused:
		return LangyTierSandboxed, ""
	case req.IsDevelopment && !req.ContainerRuntimeAvailable:
		return LangyTierHostUnsafe, LangyHostFallbackNotice
	default:
		return LangyTierSandboxed, ""
	}
}

// IsDevelopmentEnvironment reports whether the environment names a stack runs
// under describe a development machine. The allowlist is the one
// services/langyagent enforces on the isolation bypass, so both sides of the
// boundary call the same set of names development.
//
// An empty pair is development: haven is a local-dev orchestrator that starts
// every child with NODE_ENV=development, so a checkout that names no
// environment at all is a laptop. A name outside the allowlist is not, which is
// what keeps the fallback below fail-closed for staging, production, or a name
// nobody has taught this function yet.
func IsDevelopmentEnvironment(nodeEnv, environment string) bool {
	for _, name := range []string{nodeEnv, environment} {
		switch strings.ToLower(strings.TrimSpace(name)) {
		case "", "local", "dev", "development", "test":
		default:
			return false
		}
	}
	return true
}

// RunsInContainer reports whether haven launches the worker inside the colima VM
// (the sandboxed and container-unsafe tiers) rather than as a bare host process.
func (t LangyTier) RunsInContainer() bool { return t != LangyTierHostUnsafe }

// DisablesUIDSandbox reports whether the ADR-033 per-worker UID sandbox is off —
// i.e. whether haven sets LANGY_UNSAFE_DEV_DISABLE_ISOLATION on the worker. True
// for both unsafe tiers; false for the default sandboxed tier, where the container
// runs as root and the setuid+chown sandbox works, matching production.
func (t LangyTier) DisablesUIDSandbox() bool { return t != LangyTierSandboxed }

// String renders the tier for logs and `haven` output.
func (t LangyTier) String() string {
	switch t {
	case LangyTierSandboxed:
		return "sandboxed"
	case LangyTierContainerUnsafe:
		return "container-unsafe"
	case LangyTierHostUnsafe:
		return "host-unsafe"
	default:
		return "unknown"
	}
}

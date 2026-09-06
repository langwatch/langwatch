package domain

// LangyTier is the local isolation posture haven runs the langyagent worker
// under. It is resolved from two developer-set env flags and decides two things
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
	// by LANGY_UNSAFE_HOST_ACCESS (which implies the container relaxation above).
	LangyTierHostUnsafe
)

// ResolveLangyTier maps the two developer flags to a tier. Host access is the
// strongest opt-in and implies the container relaxation, so it wins whenever set;
// otherwise the container-relaxation flag steps down one rung; otherwise the
// default sandboxed (production-like) tier. This ordering means an accidental
// LANGY_UNSAFE_HOST_ACCESS with no LANGY_UNSAFE_CONTAINER still resolves sensibly
// (host access is strictly more permissive) rather than to a nonsensical combo.
func ResolveLangyTier(unsafeContainer, unsafeHostAccess bool) LangyTier {
	switch {
	case unsafeHostAccess:
		return LangyTierHostUnsafe
	case unsafeContainer:
		return LangyTierContainerUnsafe
	default:
		return LangyTierSandboxed
	}
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

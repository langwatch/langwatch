package app

import (
	"context"
	"os/exec"
	"syscall"
)

// Runner is the isolation substrate a worker's coding-agent process runs in —
// the ADR-033 seam, chosen ONCE at the composition root instead of threading a
// posture through the whole spawn path.
//
// The sandboxed runner gives each worker a private setuid UID and chowns its
// files to it, so a sibling worker (a different UID) cannot open(2) another's
// process environment or session directory at the kernel level. The
// sharedidentity runner runs every worker as the manager's own user, because a
// non-root manager can neither setuid nor chown.
//
// ADR-130 made that second posture an OPERATOR'S CHOICE rather than a dev-only
// escape: a cluster enforcing Pod Security Admission "restricted" admits no pod
// that can setuid at all, so there it is the only posture that runs. It is
// selected by LANGY_WORKER_ISOLATION, acknowledged in the operator's values
// file, and announced at boot. Sibling identity isolation is genuinely gone
// under it — what survives is structural and needs no privilege: a worker opens
// no listener, and no credential is written to disk.
//
// Implemented by adapters/runner/sandboxed and adapters/runner/sharedidentity.
type Runner interface {
	// CommandContext builds the coding-agent command. Production wraps the
	// binary with prlimit; local development executes it directly.
	CommandContext(ctx context.Context, binary string, args ...string) *exec.Cmd
	// Chown gives a provisioned file to the worker's per-conversation UID so a
	// sibling worker cannot read it. A no-op under shared identity (mode 0700
	// alone gates there, since every worker is the same user).
	Chown(path string, uid uint32) error
	// Lchown is Chown for a symlink — it chowns the link itself, not its target.
	Lchown(path string, uid uint32) error
	// SysProcAttr builds the subprocess attributes for the coding-agent process:
	// sandboxed drops it into the per-conversation UID via a setuid Credential
	// (with an explicit empty supplementary-group set); sharedidentity sets no
	// Credential. BOTH set Setpgid so the manager can signal the agent + its
	// shelled children as one process group on shutdown.
	SysProcAttr(uid uint32) *syscall.SysProcAttr
	// AppliesIdentity reports whether this runner actually puts the worker under
	// the uid it is handed. False means every Chown is a no-op and SysProcAttr
	// ignores the argument, so the pool stops reserving a per-conversation uid
	// it cannot enforce (ADR-130 §4). Reserving an identity nothing applies
	// leaves a number in the logs and in the registry that a reader will believe
	// describes the running process, and it lets a spawn fail closed on a
	// resource that is not being enforced.
	AppliesIdentity() bool
	// Name identifies the runner in logs and telemetry.
	Name() string
}

package app

import "syscall"

// Runner is the isolation substrate a worker's coding-agent process runs in —
// the ADR-033 secure-vs-local seam, chosen ONCE at the composition root instead
// of threading a disable-isolation bool through the whole spawn path. The
// sandboxed runner gives each worker a private setuid UID and chowns its files
// to it, so a sibling worker (a different UID) cannot open(2) another's session
// key / GH token / repo clone at the kernel level; the localUNSAFE runner runs
// everything as the manager's own (unprivileged) user, because a non-root dev
// manager can neither setuid nor chown — sibling isolation is GONE there, which
// is acceptable ONLY on a single-tenant dev box.
//
// Implemented by adapters/runner/sandboxed and adapters/runner/localunsafe. The three
// methods are precisely the operations that used to branch on the bool.
type Runner interface {
	// Chown gives a provisioned file to the worker's per-conversation UID so a
	// sibling worker cannot read it. A no-op in local mode (mode 0700 alone gates
	// there, since the manager owns the files).
	Chown(path string, uid uint32) error
	// Lchown is Chown for a symlink — it chowns the link itself, not its target.
	Lchown(path string, uid uint32) error
	// SysProcAttr builds the subprocess attributes for the coding-agent process:
	// sandboxed drops it into the per-conversation UID via a setuid Credential
	// (with an explicit empty supplementary-group set); local sets no Credential
	// (no privilege to setuid). BOTH set Setpgid so the manager can signal the
	// agent + its shelled children as one process group on shutdown.
	SysProcAttr(uid uint32) *syscall.SysProcAttr
	// Name identifies the runner in logs and telemetry.
	Name() string
}

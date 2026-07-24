// Package sandboxed is the production isolation substrate (app.Runner): each
// worker's coding-agent process is dropped into a private per-conversation setuid
// UID, and its files are chowned to that UID, so a sibling worker running as a
// different UID cannot open(2) another's session key / GH token / repo clone at
// the kernel level (ADR-033). Requires the container to run as root with
// CAP_SETUID + CAP_SETGID + CAP_CHOWN + CAP_DAC_OVERRIDE — the chart grants
// exactly that capability set and drops everything else.
package sandboxed

import (
	"context"
	"os"
	"os/exec"
	"syscall"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

// Runner is the sandboxed isolation substrate. Stateless — the per-worker UID is
// passed in per call.
type Runner struct{}

// compile-time proof Runner satisfies the app port.
var _ app.Runner = Runner{}

// New returns the sandboxed runner. It is the secure default; the composition
// root selects it whenever LANGY_UNSAFE_DEV_DISABLE_ISOLATION is not armed.
func New() Runner { return Runner{} }

// Name identifies the runner in logs and telemetry.
func (Runner) Name() string { return "sandboxed" }

// CommandContext applies per-worker process/file limits before execing
// OpenCode. RLIMIT_NPROC is accounted per UID, which matches this runner's
// per-conversation identity boundary. Memory remains a pod-level cgroup limit;
// Bun's large virtual address reservation makes RLIMIT_AS unsuitable.
func (Runner) CommandContext(ctx context.Context, binary string, args ...string) *exec.Cmd {
	limitArgs := []string{
		"--nproc=64:64",
		"--nofile=1024:1024",
		"--fsize=1073741824:1073741824",
		"--core=0:0",
		"--",
		binary,
	}
	return exec.CommandContext(ctx, "/usr/bin/prlimit", append(limitArgs, args...)...)
}

// Chown gives path to the per-conversation UID. Explicit chown is what makes
// "only the worker UID can read this" literal — without it the root manager
// could still read a worker's plaintext credentials.
func (Runner) Chown(path string, uid uint32) error {
	return os.Chown(path, int(uid), int(uid))
}

// Lchown chowns the symlink itself (not its target).
func (Runner) Lchown(path string, uid uint32) error {
	return os.Lchown(path, int(uid), int(uid))
}

// SysProcAttr drops the subprocess into the per-conversation UID via a setuid
// Credential. The explicit empty Groups forces setgroups([]) on exec — without
// it the child would inherit the (root) manager's supplementary groups; combined
// with the unique per-conv UID the worker then belongs to exactly one identity at
// the kernel level. Setpgid puts opencode in its own process group so a SIGTERM
// to the manager doesn't tear the worker down before we gracefully reap it.
func (Runner) SysProcAttr(uid uint32) *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Credential: &syscall.Credential{
			Uid:    uid,
			Gid:    uid,
			Groups: []uint32{},
		},
		Setpgid: true,
	}
}

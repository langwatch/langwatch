// Package sharedidentity is the isolation substrate (app.Runner) that runs every
// coding-agent process as the manager's own user, with NO setuid and NO chown.
//
// Sibling isolation is GONE in this mode: with one identity for every worker,
// one conversation's worker can read another's live credentials out of
// /proc/<pid>/environ and its conversation content out of the session
// directory. It is NOT a sandbox — it is the absence of one boundary, with
// every other boundary intact.
//
// Two situations want it, and they used to be treated as one:
//
//   - Local development, where the manager runs as an unprivileged user and can
//     perform neither the chown nor the setuid, so no worker could start at all.
//   - A cluster whose policy refuses a root pod (Pod Security Admission
//     "restricted", or an equivalent Gatekeeper / Kyverno rule). There the
//     isolated posture is not admitted, so the choice is not "isolated or
//     less isolated" but "the assistant or nothing" (ADR-130).
//
// This package was named `localunsafe` and refused to construct itself outside
// a local-like ENVIRONMENT, as a second guard beyond the config layer. That
// barricade decided for every operator that no assistant beats an assistant
// without the UID wall, which is not a decision the code gets to make for a
// single-tenant install whose users are all colleagues. The gate is now the
// operator's own acknowledgement, written in their values file and refused at
// chart render time without it, and the environment allowlist is gone.
package sharedidentity

import (
	"context"
	"os/exec"
	"syscall"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

// Runner is the shared-identity isolation substrate. Stateless; its zero value
// is usable.
type Runner struct{}

// compile-time proof Runner satisfies the app port.
var _ app.Runner = Runner{}

// New returns the shared-identity runner.
//
// It takes no arguments and cannot fail. The refusal it used to perform — an
// ENVIRONMENT allowlist, duplicated here and in the config layer so the two
// could not drift into a single point of failure — is replaced by the
// operator's acknowledgement at the chart boundary, which is the layer that
// actually knows whether this posture was chosen or stumbled into. Keeping a
// second, environment-shaped guard here would only make the supported posture
// reachable by lying about ENVIRONMENT, which is read by telemetry and logging
// well beyond this decision.
func New() Runner { return Runner{} }

// AppliesIdentity is false: Chown and Lchown are no-ops and SysProcAttr sets
// no Credential, so a uid handed to this runner is never applied to
// anything. The pool reads this to stop reserving one (ADR-130 §4).
func (Runner) AppliesIdentity() bool { return false }

// Name identifies the runner in logs and telemetry.
func (Runner) Name() string { return "shared-identity" }

// CommandContext runs the worker with no isolation wrapper.
func (Runner) CommandContext(ctx context.Context, binary string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, binary, args...)
}

// Chown is a no-op: the manager already owns the files it wrote, and mode 0700
// alone gates them — there is no sibling-UID separation in this mode.
func (Runner) Chown(path string, uid uint32) error { return nil }

// Lchown is a no-op, for the same reason as Chown.
func (Runner) Lchown(path string, uid uint32) error { return nil }

// SysProcAttr returns a process group, and deliberately NO Credential: the
// child runs under the manager's own identity. Setpgid is kept because the
// orphan reaper and the shutdown path both signal the worker's whole process
// group, which is orthogonal to identity.
func (Runner) SysProcAttr(uid uint32) *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}

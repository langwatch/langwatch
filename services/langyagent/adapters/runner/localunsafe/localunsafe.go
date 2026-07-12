// Package localunsafe is the LOCAL-DEV isolation substrate (app.Runner): it runs
// the coding-agent process as the manager's own (unprivileged) user with NO
// setuid and NO chown, because a non-root dev manager can do neither. Sibling
// isolation is GONE in this mode — a worker can read another worker's files —
// which is acceptable ONLY on a single-tenant dev box. The package name carries
// UNSAFE on purpose, and New refuses to construct it outside a local-like
// environment as a second, independent guard beyond the config-layer check.
package localunsafe

import (
	"fmt"
	"strings"
	"syscall"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

// Runner is the unsafe local isolation substrate. Stateless; its zero value is
// usable (tests construct Runner{} directly to bypass the environment guard,
// which only gates the real composition-root New below).
type Runner struct{}

// compile-time proof Runner satisfies the app port.
var _ app.Runner = Runner{}

// New returns the unsafe local runner, but ONLY for a local-like environment.
// This is a SECOND, independent guard on top of config.LoadConfig's refusal to
// arm LANGY_UNSAFE_DEV_DISABLE_ISOLATION outside local dev (defense in depth): the
// no-isolation substrate must never be constructible in production even if the
// config guard were bypassed or removed. It keeps its own environment allowlist
// rather than importing the config layer, so the two guards cannot drift into a
// single point of failure. environment is ENVIRONMENT; anything not explicitly
// local-like fails closed.
func New(environment string) (Runner, error) {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "local", "dev", "development", "test":
		return Runner{}, nil
	default:
		return Runner{}, fmt.Errorf(
			"localunsafe runner refused for ENVIRONMENT=%q — the no-isolation substrate may only run in local development",
			environment,
		)
	}
}

// Name identifies the runner in logs and telemetry.
func (Runner) Name() string { return "local-unsafe" }

// Chown is a no-op: the unprivileged manager already owns the files it wrote, and
// mode 0700 alone gates them (there is no sibling-UID separation in this mode).
func (Runner) Chown(path string, uid uint32) error { return nil }

// Lchown is a no-op, for the same reason as Chown.
func (Runner) Lchown(path string, uid uint32) error { return nil }

// SysProcAttr sets ONLY Setpgid: opencode runs as the manager's own user (no
// setuid Credential — a non-root manager cannot setuid), still in its own process
// group so the manager can group-kill it and its shelled children on shutdown.
func (Runner) SysProcAttr(uid uint32) *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}

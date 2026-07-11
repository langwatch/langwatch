// Package app is thuishaven's application core. It orchestrates the domain
// through a set of ports (interfaces) whose implementations live in adapters/,
// so the logic here has no direct dependency on portless, the filesystem, the
// process table, or net/http — and is testable with fakes.
package app

import (
	"context"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Proxy is the portless control surface: it maps hostnames to loopback ports.
type Proxy interface {
	Register(service, slug string, port int) error
	Remove(service, slug string)
	Running() bool
	// Endpoint reports how the proxy is reachable (scheme, port) so URLs are
	// correct on the default 443 or an unprivileged port.
	Endpoint() (scheme string, port int)
}

// Store persists everything under the thuishaven home dir plus the two
// worktree-local files (the slug cache and the .env.portless overlay).
type Store interface {
	SaveStack(domain.Stack) error
	RemoveStack(slug string)
	Stacks() []domain.Stack
	TakenSlugs() map[string]bool
	ReadSlugCache(worktreeDir string) (string, bool)
	WriteSlugCache(worktreeDir, slug string) error
	WriteOverlay(lwDir string, st domain.Stack) error
	SaveDaemon(DaemonInfo) error
	Daemon() (DaemonInfo, bool)
	ClearDaemon()
}

// Supervisor runs child processes: one-shot prepare/seed steps and the
// long-running, restart-on-crash service set.
type Supervisor interface {
	RunOnce(ctx context.Context, name, dir, shell string, env []string) error
	Supervise(ctx context.Context, children []Child)
}

// Child is one supervised process.
type Child struct {
	Name  string
	Dir   string
	Shell string
	Env   []string
	Color string
}

// System is the set of OS facts the app needs, behind a port so it can be faked.
type System interface {
	FreePorts(n int) ([]int, error)
	PortInUse(port int) bool
	ProcessAlive(pid int) bool
	Terminate(pid int)
	SpawnDetached(argv []string, dir, logPath string) error
	Now() time.Time
	Getpid() int
}

// Dashboard serves the daemon's HTTP surface (dashboard, registry API, telemetry
// fan-out). It reads live state through the callbacks it is constructed with.
type Dashboard interface {
	Serve(ctx context.Context, port int) error
}

// DaemonInfo is the little record `up` reads to find (or spawn) the daemon.
type DaemonInfo struct {
	PID  int    `json:"pid"`
	Port int    `json:"port"`
	URL  string `json:"url"`
}

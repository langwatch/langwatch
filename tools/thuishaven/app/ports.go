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

// ClickHouse manages one shared, single-node, memory-capped clickhouse-server on
// the host and the per-slug databases on it. Every worktree shares the one server
// but reads/writes only its own database (lw_<slug>) — so migration counts are
// always this worktree's own, and parallel stacks can't OOM the box. No S3 /
// cold-storage tiering and no zero-copy replication (prod-only concerns that only
// cause pain locally).
type ClickHouse interface {
	// Ensure starts the shared server if it is not already running and returns its
	// loopback HTTP port. Safe to call concurrently across worktrees (file-locked).
	Ensure(ctx context.Context) (httpPort int, err error)
	// EnsureDatabase creates a stack's database if it does not exist.
	EnsureDatabase(ctx context.Context, database string) error
	// DropDatabase removes a stack's database — the "give me a fresh DB" affordance.
	DropDatabase(ctx context.Context, database string) error
	// HTTPPort returns the managed server's HTTP port if known, without starting it
	// (0 when it has never been provisioned).
	HTTPPort() int
	// Running reports whether the managed server answers right now (no start).
	Running() bool
	// Health pings the server and returns a one-line status for `haven doctor`.
	Health(ctx context.Context) (ok bool, detail string)
	// Databases lists the lw_* databases currently on the server.
	Databases(ctx context.Context) ([]string, error)
	// Stop halts the managed server (the daemon calls this when no stacks remain).
	Stop()
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

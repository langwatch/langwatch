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
	// Installed reports whether a real portless binary is resolvable (a global
	// install, a project-local one, or PORTLESS_BIN) rather than the on-demand
	// `npx` fallback — so `haven setup` can tell the user to install it once.
	Installed() bool
	// EnsureReady boots the proxy if it is not already running and trusts its CA
	// on first run, so `haven up` self-bootstraps without a prior `haven setup`.
	// Idempotent; the CA trust is guarded so it does not re-prompt on every launch.
	EnsureReady() error
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
	// HMR gate marker (worktree-local): expiry in unix-ms; 0/absent means no gate.
	WriteHMRGate(lwDir string, expiryUnixMs int64) error
	ReadHMRGate(lwDir string) (int64, bool)
	ClearHMRGate(lwDir string)
	// ClaimDaemon atomically records this process as the singleton daemon, but
	// only if no record exists yet (O_EXCL). It returns false without overwriting
	// when one already does, so two daemons racing to start can never both win.
	ClaimDaemon(DaemonInfo) (bool, error)
	Daemon() (DaemonInfo, bool)
	ClearDaemon()
}

// Supervisor runs child processes: one-shot prepare/seed steps and the
// long-running, restart-on-crash service set.
type Supervisor interface {
	RunOnce(ctx context.Context, name, dir, shell string, env []string) error
	// RunOnceBounded is RunOnce plus a reaper: it kills the process (group) if
	// limits.MaxRSSBytes or limits.MaxDuration is crossed, rather than letting a
	// runaway one-shot (tsgo) sit on a slot forever.
	RunOnceBounded(ctx context.Context, name, dir, shell string, env []string, limits ReapLimits) error
	Supervise(ctx context.Context, children []Child)
}

// ReapLimits bounds a RunOnceBounded call. Either field left at 0 disables that
// particular check.
type ReapLimits struct {
	MaxRSSBytes int64
	MaxDuration time.Duration
}

// Child is one supervised process.
type Child struct {
	Name  string
	Dir   string
	Shell string
	Env   []string
	Color string
	// ReadyProbeURL, if set, holds this child's start until an HTTP GET to the URL
	// gets a non-5xx response — so a lane that depends on another (the web/app on
	// the API) never starts before what it needs is serving. Empty = start now.
	ReadyProbeURL string
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
	// TotalMemory is the machine's physical RAM in bytes (0 if undetectable).
	TotalMemory() uint64
}

// ClickHouse manages one shared, memory-capped Altinity ClickHouse container (on
// colima) and the per-slug databases on it. Every worktree shares the one
// container but reads/writes only its own database (lw_<slug>) — so migration
// counts are always this worktree's own, and parallel stacks can't OOM the box.
type ClickHouse interface {
	// Ensure starts the shared container if it is not already running and returns
	// its loopback HTTP port. Safe to call concurrently across worktrees.
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

// Postgres manages one shared, brew-services Postgres and the per-slug
// databases on it — the same one-server-many-databases pattern as ClickHouse.
// Unlike ClickHouse, haven does not own the server's full lifecycle: a
// brew-managed Postgres is a machine-wide resource other local work may
// already depend on, so Stop is expected to be a no-op in real adapters.
type Postgres interface {
	// Ensure starts (or reuses an already-running) shared server and ensures the
	// shared role exists. Returns the loopback port. Safe to call concurrently.
	Ensure(ctx context.Context) (port int, err error)
	// EnsureDatabase creates a stack's database if it does not exist.
	EnsureDatabase(ctx context.Context, database string) error
	// DropDatabase removes a stack's database — the "give me a fresh DB" affordance.
	DropDatabase(ctx context.Context, database string) error
	// Port returns the configured port, without starting anything.
	Port() int
	// Running reports whether the server answers right now (no start).
	Running() bool
	// Health pings the server and returns a one-line status for `haven doctor`.
	Health(ctx context.Context) (ok bool, detail string)
	// Databases lists the lw_* databases currently on the server.
	Databases(ctx context.Context) ([]string, error)
	// Stop is a no-op in the real adapter (see type doc); kept for symmetry with
	// ClickHouse and so a future adapter that DOES own the server can implement it.
	Stop()
}

// Redis ensures a shared Redis server exists. No per-slug database is needed —
// domain.RedisDBForSlug already partitions worktrees by DB index on the one
// server — so this port is deliberately smaller than ClickHouse/Postgres.
type Redis interface {
	// Ensure starts (or reuses an already-running) shared server. Returns the
	// loopback port. Safe to call concurrently.
	Ensure(ctx context.Context) (port int, err error)
	// Port returns the configured port, without starting anything.
	Port() int
	// Running reports whether the server answers right now (no start).
	Running() bool
	// Health pings the server and returns a one-line status for `haven doctor`.
	Health(ctx context.Context) (ok bool, detail string)
	// Stop is a no-op in the real adapter — a brew-managed Redis is a
	// machine-wide resource other local work may already depend on.
	Stop()
}

// Observability manages the shared local LGTM stack — one OTLP collector fronting
// Loki, Tempo and Prometheus, with Grafana over all three — that every worktree
// exports its logs, traces and metrics to. One stack for the machine, tagged per
// worktree, so an agent can read what its own stack just did.
type Observability interface {
	// Ensure starts the stack if it is not already answering and returns the
	// endpoints to export to. Idempotent across worktrees.
	Ensure(ctx context.Context) (domain.ObservabilityEndpoints, error)
	// Stop removes the stack, discarding the telemetry it collected (it keeps no
	// volume — a debugging window, not an archive).
	Stop(ctx context.Context) error
	// IsRunning reports whether the stack is answering right now, without starting it.
	IsRunning(ctx context.Context) bool
	// Health returns a one-line status for `haven doctor`.
	Health(ctx context.Context) (ok bool, detail string)
	// Endpoints reports the stack's ports without touching the runtime.
	Endpoints() domain.ObservabilityEndpoints
}

// Dashboard serves the daemon's HTTP surface (dashboard, registry API, telemetry
// fan-out). It reads live state through the callbacks it is constructed with.
type Dashboard interface {
	Serve(ctx context.Context, port int) error
}

// Semaphore is a machine-wide counting semaphore so parallel, memory-hungry work
// across worktrees (tsgo typechecks) can be bounded to a slot count.
type Semaphore interface {
	// Acquire blocks until one of `slots` slots for `name` is free; returns a
	// release func and the 1-based slot taken. ctx cancellation aborts the wait.
	Acquire(ctx context.Context, name string, slots int) (release func(), slot int, err error)
}

// Hygiene is the disk-reclamation surface: enumerating a repo's worktrees,
// checking for uncommitted work, sizing reclaimable artefacts, removing them, and
// pruning orphaned git worktree admin entries.
type Hygiene interface {
	Worktrees(repoRoot string) ([]Worktree, error)
	Dirty(worktreeDir string) bool
	DirSize(path string) (bytes int64, exists bool)
	Remove(path string) error
	PruneGitWorktrees(repoRoot string)
}

// Worktree is one entry from `git worktree list`.
type Worktree struct {
	Dir    string
	Branch string
}

// DaemonInfo is the little record `up` reads to find (or spawn) the daemon.
type DaemonInfo struct {
	PID  int    `json:"pid"`
	Port int    `json:"port"`
	URL  string `json:"url"`
}

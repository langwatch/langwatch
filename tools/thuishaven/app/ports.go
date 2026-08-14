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
	// on first run, so `haven up` self-bootstraps with no setup command at all.
	// Idempotent; the CA trust is guarded so it does not re-prompt on every launch.
	EnsureReady() error
	// Install installs portless itself — `up`'s bootstrap when Installed() is
	// false, so a fresh machine needs nothing but `haven up`.
	Install() error
	// Endpoint reports how the proxy is reachable (scheme, port) so URLs are
	// correct on the default 443 or an unprivileged port.
	Endpoint() (scheme string, port int)
	// Shutdown stops the proxy daemon — the tail of `haven down --all`. A proxy
	// that is not running is not an error.
	Shutdown() error
	// CACertPath returns the portless Local CA PEM path (or "" if absent) so the
	// orchestrator can point Bun/Node children at it via NODE_EXTRA_CA_CERTS —
	// those runtimes ignore the macOS system trust store the CA is installed into.
	CACertPath() string
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
	// The worktree-local sticky service selection (ADR-064): what `haven up`
	// runs here, surviving terminals and reboots. ok=false means never written.
	ReadSelection(worktreeDir string) (domain.Selection, bool)
	WriteSelection(worktreeDir string, sel domain.Selection) error
	WriteOverlay(lwDir string, st domain.Stack) error
	// HMR gate marker (worktree-local): expiry in unix-ms; 0/absent means no gate.
	WriteHMRGate(lwDir string, expiryUnixMs int64) error
	ReadHMRGate(lwDir string) (int64, bool)
	ClearHMRGate(lwDir string)
	// TouchDBActivity records "slug's databases were in use now" — the clock the
	// daemon's idle-database pruning reads. Touched on every `up` and refreshed
	// by the daemon while a stack stays registered.
	TouchDBActivity(slug string) error
	DBActivity() map[string]time.Time
	RemoveDBActivity(slug string)
	// ClaimDaemon atomically records this process as the singleton daemon, but
	// only if no record exists yet (O_EXCL). It returns false without overwriting
	// when one already does, so two daemons racing to start can never both win.
	ClaimDaemon(DaemonInfo) (bool, error)
	Daemon() (DaemonInfo, bool)
	ClearDaemon()
	// WritePressure publishes the daemon's current reading of the machine, and
	// ReadPressure is how every other process on the box consults it. Absent,
	// unparseable, stale or written by an unknown version all read as "no
	// record", which callers treat as green — it disables narrowing and refusal
	// and nothing else, so slot counting never depends on the daemon running.
	WritePressure(domain.PressureRecord) error
	ReadPressure() (domain.PressureRecord, bool)
	// HeavyRuns counts the heavy runs live on this machine right now, across
	// every worktree and terminal. Occupancy is derived from whether each
	// recorded pid is still alive, so a killed run frees its place with no
	// bookkeeping — the same property #6598's queue relies on.
	HeavyRuns() int
	// ClaimHeavyRun records this process as holding a heavy slot and returns the
	// release. The claim is what makes a rewrapped run visible to every other
	// caller on the machine.
	ClaimHeavyRun(pid int, command string) (release func(), err error)
	// ObservedDuration is how long this command has taken before, or zero when
	// it has never been timed. Zero is load-bearing: an unobserved command is
	// treated as long, so it queues rather than being narrowed on a guess.
	ObservedDuration(command string) time.Duration
	// ObserveDuration records how long a run actually took, so the next one can
	// be decided on evidence rather than a default.
	ObserveDuration(command string, took time.Duration)
	// AppendReapEvent records one daemon reclamation (bounded ring, oldest
	// dropped) and ReapEvents reads the record newest-last — the hub's "what
	// has the reaper been doing" feed. Append failures are the daemon's to
	// log; losing an event must never stop a reap.
	AppendReapEvent(ev domain.ReapEvent) error
	ReapEvents() []domain.ReapEvent
}

// ClaudeSettings writes another tool's configuration, which is why it is not on
// Store: everything Store persists is haven's OWN state — stacks, slugs,
// selections, the daemon record, heavy-run slots. This edits a file in the
// developer's repo that belongs to Claude Code, and only `haven setup` uses it.
type ClaudeSettings interface {
	// EnsureHook registers command as a PreToolUse hook in repoRoot's
	// .claude/settings.local.json — untracked and per worktree. It merges: an
	// existing hooks block survives and an entry already present is left alone,
	// so it reports whether anything actually changed.
	EnsureHook(repoRoot, command string) (installed bool, err error)
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
	// WaitReady blocks until an HTTP GET to url gets a non-5xx response, the same
	// probe Child.ReadyProbeURL gates a lane on. It reports false when the context
	// ended first, so a caller that must not act on a stack that never came up
	// (the play sandbox's seed ingest) can tell "ready" from "gave up".
	WaitReady(ctx context.Context, name, url string) bool
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
	// LogPath, if set, captures every output line (timestamped) to this file —
	// size-capped with one rotated generation — whether the stack runs attached
	// or detached. It is what `haven logs` reads (ADR-064: logs are a tap).
	LogPath string
}

// ProcessSample is one live process as the tsgo governor's sampler sees it.
type ProcessSample struct {
	PID      int
	PGID     int // process group, for attributing a process to a stack's launcher group
	RSSBytes int64
	CPUTime  time.Duration // total CPU clock, for idle detection across ticks
	Elapsed  time.Duration // wall-clock age
	Command  string
}

// ProcTelemetry ships the process watch's observations to the local
// observability stack, so "how big does tsgo get", "how many vitest workers
// run at once" and "what did the governor kill" become queryable history
// instead of anecdotes. Implementations must be fire-and-forget: when the
// stack is down, observations are dropped silently, never buffered or logged
// into a spam stream.
type ProcTelemetry interface {
	// RecordSample publishes the current footprint of every watched class.
	// Called from the daemon's monitor goroutine only — implementations may
	// rely on that and skip synchronization.
	RecordSample(procs []domain.WatchedProcess)
	// RecordKill counts one governor enforcement, by class and reason.
	RecordKill(class, reason string)
	// Close flushes the final observations and stops the exporter. Bounded:
	// it must never block daemon shutdown on an unreachable stack.
	Close()
}

// System is the set of OS facts the app needs, behind a port so it can be faked.
type System interface {
	FreePorts(n int) ([]int, error)
	PortInUse(port int) bool
	ProcessAlive(pid int) bool
	Terminate(pid int)
	// TerminateGroup SIGTERMs pid's whole process group — how `haven restart`
	// bounces one supervised child (its supervisor restarts it on exit).
	TerminateGroup(pid int)
	// KillGroup SIGKILLs pid's whole process group — `down -f`'s hard stop for
	// a stack that must die now (or won't die gracefully).
	KillGroup(pid int)
	PIDsOnPort(port int) []int
	SpawnDetached(argv []string, dir, logPath string) error
	Now() time.Time
	Getpid() int
	// TotalMemory is the machine's physical RAM in bytes (0 if undetectable).
	TotalMemory() uint64
	// GroupRSS is the resident set of a process group (keyed by any member pid),
	// in bytes — a stack's real memory footprint (0 if undetectable).
	GroupRSS(pid int) uint64
	// MemStat samples the machine's memory-pressure signals: compressor
	// occupancy and swap, which unlike summed RSS do not double-count shared
	// pages. An unreadable signal stays zero and classifies green (ADR-090).
	MemStat() domain.MemStat
	// DemoteGroup moves a process group into the throttled background band, and
	// RestoreGroup moves it back. The group, not the launcher: the policy is
	// inherited only by processes forked after it is set, so a tree that is
	// already running has to be walked.
	DemoteGroup(pid int)
	RestoreGroup(pid int)
	// ProcessSamples lists every live process with the facts the tsgo governor
	// needs (ADR-095): resident set, CPU clock, elapsed age, command line.
	// Filtering to tsgo is the caller's job via domain.IsTsgoCommand — the
	// sampler stays generic and the selection rule stays in one testable place.
	ProcessSamples() []ProcessSample
	// Kill SIGKILLs one process — never its group. The tsgo governor's targets
	// are children of queue wrappers and daemons whose process group includes
	// exactly the supervisors that must survive the kill.
	Kill(pid int)
	// OrphanedWorkers lists processes matching marker whose parent is PID 1 —
	// test workers an interrupted run left behind, owned by nobody.
	OrphanedWorkers(marker string) []int
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
	Worktrees(gitDir string) ([]Worktree, error)
	Dirty(worktreeDir string) bool
	DirSize(path string) (bytes int64, exists bool)
	// DiskUsage is a whole-worktree size for the prune picker: how much disk
	// deleting the worktree would reclaim. Unlike DirSize (a Go tree-walk summing
	// file sizes, used by the artefact reclaim), this shells out to `du` for speed
	// on a big tree — the difference matters when sizing dozens of worktrees at once.
	// It takes a context so an in-flight `du` is killed when sizing is cancelled
	// (the picker cancels it the moment a delete starts, freeing the disk at once).
	DiskUsage(ctx context.Context, path string) (bytes int64, ok bool)
	Remove(path string) error
	PruneGitWorktrees(repoRoot string)
	// RemoveWorktree deletes a linked worktree (directory + git admin entry),
	// forcing past uncommitted changes — the app layer owns the confirmation.
	RemoveWorktree(gitDir, dir string) error
	// LastActivity reports when a worktree was last worked on — the committer date
	// of its checked-out HEAD, falling back to the directory's own mtime. It is the
	// "how long has this sat idle" signal interactive prune ranks and default-selects
	// by; the bool is false only when neither can be established.
	LastActivity(worktreeDir string) (t time.Time, ok bool)
	// UpstreamGone reports whether the branch tracks an upstream whose remote-tracking
	// ref no longer exists — the "merged, and the remote branch was deleted" signal
	// that marks a worktree as a prime cleanup candidate. It reflects the local
	// remote-tracking state, so it needs a prior `git fetch --prune` to be current;
	// false for a branch with no upstream, a detached HEAD, or when git cannot tell.
	UpstreamGone(worktreeDir, branch string) bool
}

// Worktree is one entry from `git worktree list`.
type Worktree struct {
	Dir    string
	Branch string
}

// ContainerRuntime is the colima VM haven runs shared containers on. The
// langyagent worker's sandboxed / container-unsafe tiers launch the worker as a
// container on it (see domain.LangyTier); it is the same VM ClickHouse and the
// observability stack already share.
type ContainerRuntime interface {
	// Ensure guarantees the VM is up and returns the DOCKER_HOST that addresses its
	// daemon, so `docker` commands target this profile's socket rather than whatever
	// context happens to be selected.
	Ensure(ctx context.Context) (dockerHost string, err error)
	// Profile is the colima profile name, for logs and error messages.
	Profile() string
}

// ContainerJanitor sweeps containers a testcontainers run left behind in the
// shared VM (specs/setup/haven-testcontainer-reaper.feature). ReapTestContainers
// removes every testcontainers-labeled container older than its cutoff —
// stopped containers against stoppedCutoff, still-running ones against the
// more lenient runningCutoff — and returns the removed containers' names;
// when the VM is down it does nothing rather than boot it.
type ContainerJanitor interface {
	ReapTestContainers(ctx context.Context, stoppedCutoff, runningCutoff time.Time) ([]string, error)
}

// DaemonInfo is the little record `up` reads to find (or spawn) the daemon.
type DaemonInfo struct {
	PID  int    `json:"pid"`
	Port int    `json:"port"`
	URL  string `json:"url"`
}

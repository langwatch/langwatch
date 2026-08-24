package app

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Config carries the knobs the orchestrator + daemon need. Everything here is
// resolved once by the composition root (cmd) and injected.
type Config struct {
	Naming  domain.Naming
	Home    string        // thuishaven home dir (~/.langwatch/portless)
	IdleTTL time.Duration // reap stacks whose heartbeat is older than this (0 = only reap dead launchers)
	// DBIdleTTL is how long a worktree's databases may sit unused before the
	// daemon prunes them in the background (0 disables pruning). Only databases
	// haven itself tracked (via the activity clock) are ever touched, and the
	// protected main database is always kept.
	DBIdleTTL time.Duration
	// TestContainerTTL is how old a stopped testcontainers-labeled container
	// must be before the daemon reaps it as leaked (0 disables the sweep
	// entirely). Fresh ones are left alone — a live test run may still be
	// using them.
	TestContainerTTL time.Duration
	// RunningTestContainerTTL is the same rule for containers still running,
	// whose age says nothing about current use (reused containers keep their
	// original creation time across runs). Clamped to at least TestContainerTTL.
	RunningTestContainerTTL time.Duration
	// Tsgo bounds what tsgo may take from the machine (ADR-095); the daemon's
	// tick enforces it over every live tsgo process regardless of who spawned
	// it. Tsgo.RunMaxRSS == 0 disables the governor.
	Tsgo                     domain.TsgoLimits
	HeartbeatEvery           time.Duration // launcher heartbeat cadence
	DaemonArgv               []string      // how to (re)launch `haven daemon`
	IsAgent                  bool          // token-free plain output for AI drivers (no color/TUI)
	ShouldManageClickHouse   bool          // haven provisions a shared ClickHouse container (colima) + per-slug DBs
	ShouldStopClickHouseIdle bool          // daemon stops the managed CH container when the last stack is reaped
	ShouldManagePostgres     bool          // haven ensures a shared brew-services Postgres + per-slug DBs
	ShouldManageRedis        bool          // haven ensures a shared brew-services Redis is running
	// RedisDBOverride pins this worktree's Redis DB index
	// (LANGWATCH_HAVEN_REDIS_DB). nil = unset, so a Config built without the
	// field never pins database 0 by accident — which a plain int sentinel does
	// on every zero-valued Config in the package.
	// The allocator's collision avoidance only sees haven-managed
	// stacks; a plain `pnpm dev` process from another worktree sits on its .env
	// db invisibly and shares the job queue, which lands work in the wrong
	// stack's database. The override makes the assignment deterministic for a
	// worktree that has to route around such a neighbor.
	RedisDBOverride *int
	// ShouldStartObservability makes `up` boot the LGTM stack itself. On by
	// default: it shares ClickHouse's colima VM, so the VM is already paying for
	// itself — opt out with LANGWATCH_HAVEN_OBS=0.
	ShouldStartObservability bool
	LocalAPIKey              string // stable local dev API key seeded + injected into every stack
	RepoRoot                 string // repo root the daemon prunes orphaned git worktrees from
	// ShouldDisableGoogleDLP injects LANGWATCH_DISABLE_GOOGLE_DLP=true into every
	// stack. On by default — local dev should never ship trace text to Google, and
	// the app then never loads the @google-cloud/dlp SDK. Setting the variable to
	// anything the app would not read as true (case-insensitive "true") opts back
	// in: haven emits nothing and .env governs, so DLP can be exercised against
	// real credentials.
	ShouldDisableGoogleDLP bool
	// ObservabilityConsoleLevel is the console log floor haven injects (as
	// LOG_CONSOLE_LEVEL) while the observability stack is up — default "warn", so the
	// terminal is quiet and the full detail lives in Grafana. "" opts out and leaves
	// the console to .env. Resolved from LW_OBS_CONSOLE_LEVEL.
	ObservabilityConsoleLevel string
	// PortlessDisabled is PORTLESS=0: `up` never starts, trusts, or registers
	// with the portless proxy, and every service's own loopback port is served
	// plain HTTP instead of routing through the proxy's shared hostname+TLS
	// port — the documented escape hatch for a machine where the proxy's TLS
	// won't come up. The zero value is false (portless enabled), matching every
	// stack provisioned before this knob existed — see domain.Stack.PortlessDisabled.
	PortlessDisabled bool
}

// PlanOptions decide which services `up` runs and how.
type PlanOptions struct {
	ShouldGoWatch bool // air hot-reload for the Go services instead of `go run`
	// Selection is the worktree's sticky service choice (ADR-064): workers
	// lane, gateway, nlp, langy. app always runs, and the worker stack always
	// runs with it — Selection.Workers only picks its own lane over in-process.
	Selection  domain.Selection
	ShouldSeed bool
	// ShouldRebuildImages (--rebuild) forces container images to be rebuilt even
	// when their content hash says nothing changed.
	ShouldRebuildImages bool
	// ShouldForce (-f) replaces the running stack even when it already matches
	// the selection — the "restart everything now" up.
	ShouldForce bool
	// langyImageTag is the content-addressed image tag Up resolves before
	// provisioning (internal — derived, never set by the composition root).
	langyImageTag string
	// LangyTier is the local isolation posture for the langyagent worker, resolved
	// from LANGY_UNSAFE_CONTAINER / LANGY_UNSAFE_HOST_ACCESS. The zero value is the
	// sandboxed (production-like) default: the worker runs in colima with the
	// per-worker UID sandbox on.
	LangyTier domain.LangyTier
	IsStub    bool // verification: echo servers instead of the real apps
	RepoRoot  string
}

// RedisDBOverrideFromEnv parses LANGWATCH_HAVEN_REDIS_DB into a Redis DB index,
// or nil when unset or out of range (the allocator then assigns one normally).
// An out-of-range value is reported on stderr rather than accepted: clamping it
// would put the stack on a database the operator did not name.
func RedisDBOverrideFromEnv(v string) *int {
	if v == "" {
		return nil
	}
	db, err := strconv.Atoi(v)
	if err != nil || db < 0 || db >= domain.RedisDBCount {
		fmt.Fprintf(os.Stderr, "haven: ignoring LANGWATCH_HAVEN_REDIS_DB=%q (want 0-%d)\n", v, domain.RedisDBCount-1)
		return nil
	}
	return &db
}

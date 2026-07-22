package app

import (
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
	DBIdleTTL                time.Duration
	HeartbeatEvery           time.Duration // launcher heartbeat cadence
	DaemonArgv               []string      // how to (re)launch `haven daemon`
	IsAgent                  bool          // token-free plain output for AI drivers (no color/TUI)
	ShouldManageClickHouse   bool          // haven provisions a shared ClickHouse container (colima) + per-slug DBs
	ShouldStopClickHouseIdle bool          // daemon stops the managed CH container when the last stack is reaped
	ShouldManagePostgres     bool          // haven ensures a shared brew-services Postgres + per-slug DBs
	ShouldManageRedis        bool          // haven ensures a shared brew-services Redis is running
	// ShouldStartObservability makes `up` boot the LGTM stack itself. On by
	// default: it shares ClickHouse's colima VM, so the VM is already paying for
	// itself — opt out with LANGWATCH_HAVEN_OBS=0.
	ShouldStartObservability bool
	LocalAPIKey              string // stable local dev API key seeded + injected into every stack
	RepoRoot                 string // repo root the daemon prunes orphaned git worktrees from
	// ObservabilityConsoleLevel is the console log floor haven injects (as
	// LOG_CONSOLE_LEVEL) while the observability stack is up — default "warn", so the
	// terminal is quiet and the full detail lives in Grafana. "" opts out and leaves
	// the console to .env. Resolved from LW_OBS_CONSOLE_LEVEL.
	ObservabilityConsoleLevel string
}

// PlanOptions decide which services `up` runs and how.
type PlanOptions struct {
	ShouldGoWatch bool // air hot-reload for the Go services instead of `go run`
	// Selection is the worktree's sticky service choice (ADR-064): workers
	// lane, gateway, nlp, langy. app always runs.
	Selection domain.Selection
	// ShouldStartWorkers is the legacy START_WORKERS=false escape: no worker
	// stack at all, neither a lane nor in-process. Env-bridge only, never
	// sticky; defaults to true.
	ShouldStartWorkers bool
	ShouldSeed         bool
	// LangyTier is the local isolation posture for the langyagent worker, resolved
	// from LANGY_UNSAFE_CONTAINER / LANGY_UNSAFE_HOST_ACCESS. The zero value is the
	// sandboxed (production-like) default: the worker runs in colima with the
	// per-worker UID sandbox on.
	LangyTier domain.LangyTier
	IsStub    bool // verification: echo servers instead of the real apps
	RepoRoot  string
}

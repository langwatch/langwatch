package app

import (
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Config carries the knobs the orchestrator + daemon need. Everything here is
// resolved once by the composition root (cmd) and injected.
type Config struct {
	Naming             domain.Naming
	Home               string        // thuishaven home dir (~/.langwatch/portless)
	ObservabilityPort  int           // Grafana LGTM port to route (default 3000)
	IdleTTL            time.Duration // reap stacks whose heartbeat is older than this (0 = only reap dead launchers)
	HeartbeatEvery     time.Duration // launcher heartbeat cadence
	DaemonArgv         []string      // how to (re)launch `haven daemon`
	Agent              bool          // token-free plain output for AI drivers (no colour/TUI)
	ManageClickHouse   bool          // haven provisions a shared native clickhouse-server + per-slug DBs
	StopClickHouseIdle bool          // daemon stops the managed CH server when the last stack is reaped
}

// PlanOptions decide which services `up` runs and how.
type PlanOptions struct {
	GoWatch      bool // air hot-reload for the Go services instead of `go run`
	StartWorkers bool
	SkipNLP      bool
	SkipGateway  bool
	Seed         bool
	Stub         bool // verification: echo servers instead of the real apps
	RepoRoot     string
}

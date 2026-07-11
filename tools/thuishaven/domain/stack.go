package domain

import "time"

// Service is one routed process within a stack.
type Service struct {
	Name     string `json:"name"`
	Role     string `json:"role"`
	Hostname string `json:"hostname"`
	URL      string `json:"url"`
	Port     int    `json:"port"`
}

// Stack is one worktree's running set of services — the unit the dashboard lists,
// the daemon monitors, and the reaper tears down.
type Stack struct {
	Slug        string `json:"slug"`
	WorktreeDir string `json:"worktreeDir"`
	Branch      string `json:"branch"`
	LauncherPID int    `json:"launcherPid"`
	RedisDB     int    `json:"redisDb"`
	// APIPort is the Hono API's loopback port. The API is NOT a routed hostname
	// of its own: it is a backend of `app`, reached same-origin at
	// app.<slug>.../api (Vite proxies /api → 127.0.0.1:APIPort). One app URL, not
	// two confusable ones — the frontend and its API share a single origin.
	APIPort            int       `json:"apiPort"`
	WorkerMetricsPort  int       `json:"workerMetricsPort"`
	ClickHouseHTTPPort int       `json:"clickhouseHttpPort"` // shared managed CH server's HTTP port (0 = unmanaged)
	ClickHouseDatabase string    `json:"clickhouseDatabase"` // this stack's isolated CH database (lw_<slug>)
	Services           []Service `json:"services"`
	// UpdatedAt is refreshed by the launcher's heartbeat; the daemon reaps a
	// stack whose launcher has died or whose heartbeat has gone stale.
	UpdatedAt time.Time `json:"updatedAt"`
}

// PerWorktreeServices are the routed hostnames a stack always plans for — each
// gets its own <name>.<slug>.langwatch.localhost. The Hono API is deliberately
// absent: it shares `app`'s origin at /api (see Stack.APIPort), so the app and
// its API are one URL. Order is the launch + print order.
var PerWorktreeServices = []struct{ Name, Role string }{
	{"app", "App — UI + API at /api"},
	{"gateway", "AI Gateway (Go)"},
	{"nlp", "NLP engine (Go)"},
}

// Stale reports whether the stack's heartbeat is older than ttl (ttl <= 0
// disables staleness — only a dead launcher triggers reaping then).
func (s Stack) Stale(now time.Time, ttl time.Duration) bool {
	if ttl <= 0 {
		return false
	}
	return now.Sub(s.UpdatedAt) > ttl
}

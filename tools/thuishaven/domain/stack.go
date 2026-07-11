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
	Slug              string    `json:"slug"`
	WorktreeDir       string    `json:"worktreeDir"`
	Branch            string    `json:"branch"`
	LauncherPID       int       `json:"launcherPid"`
	RedisDB           int       `json:"redisDb"`
	WorkerMetricsPort int       `json:"workerMetricsPort"`
	Services          []Service `json:"services"`
	// UpdatedAt is refreshed by the launcher's heartbeat; the daemon reaps a
	// stack whose launcher has died or whose heartbeat has gone stale.
	UpdatedAt time.Time `json:"updatedAt"`
}

// PerWorktreeServices are the services a stack always plans for. Order is the
// launch + print order.
var PerWorktreeServices = []struct{ Name, Role string }{
	{"app", "Vite frontend"},
	{"api", "Hono API"},
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

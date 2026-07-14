// Package redisbrew implements app.Redis: ensures ONE shared Redis is running
// via `brew services` (macOS). Unlike ClickHouse and Postgres, Redis needs no
// per-slug database — domain.RedisDBForSlug already partitions worktrees by DB
// index on the one server (see domain/slug.go) — so this adapter's only job is
// making sure a server exists to point REDIS_URL at.
//
// Same philosophy as Postgres: a brew-managed Redis is a machine-wide resource
// other local work may already depend on, so an already-running redis service
// (any) is reused as-is, and Stop is a no-op.
package redisbrew

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// Server is the brew-services-backed implementation of app.Redis.
type Server struct {
	formula     string
	port        int
	maxMemoryMB int
}

// New builds a Server for the given formula/port/cap as-is; defaulting to
// domain.DefaultRedisFormula / domain.DefaultRedisPort /
// domain.DefaultRedisMaxMemoryMB happens at the composition root
// (cmd/root.go), not here. maxMemoryMB 0 means no cap.
func New(formula string, port, maxMemoryMB int) *Server {
	return &Server{formula: formula, port: port, maxMemoryMB: maxMemoryMB}
}

// Ensure starts the configured formula via `brew services start` unless a
// redis is already running on the configured port, applies the maxmemory
// ceiling, then returns that port.
func (s *Server) Ensure(ctx context.Context) (int, error) {
	if _, err := exec.LookPath("brew"); err != nil {
		return 0, fmt.Errorf("brew is not installed — haven manages Redis via `brew services` (install: https://brew.sh)")
	}
	if !s.ping(ctx) {
		if exec.CommandContext(ctx, "brew", "list", "--formula", s.formula).Run() != nil {
			return 0, fmt.Errorf("%s is not installed — `brew install %s` (or set HAVEN_REDIS_FORMULA to a formula you already have)", s.formula, s.formula)
		}
		if err := exec.CommandContext(ctx, "brew", "services", "start", s.formula).Run(); err != nil {
			return 0, fmt.Errorf("brew services start %s: %w", s.formula, err)
		}
	}
	if err := s.waitReady(ctx, 15*time.Second); err != nil {
		return 0, err
	}
	s.applyMemoryCap(ctx)
	return s.port, nil
}

// applyMemoryCap sets maxmemory on the running server so a leaky stack fails
// loudly at the ceiling instead of paging the machine. The eviction policy is
// deliberately left alone: the default noeviction is the only policy safe for
// BullMQ queues. Best-effort — a redis that refuses CONFIG SET (renamed
// command, protected mode) still works, just uncapped.
func (s *Server) applyMemoryCap(ctx context.Context) {
	if s.maxMemoryMB <= 0 {
		return
	}
	_ = exec.CommandContext(ctx, "redis-cli", "-h", "127.0.0.1", "-p", fmt.Sprint(s.port),
		"config", "set", "maxmemory", fmt.Sprintf("%dmb", s.maxMemoryMB)).Run()
}

func (s *Server) waitReady(ctx context.Context, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if s.ping(ctx) {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("redis (%s) did not become ready on :%d within %s — check `brew services info %s`",
		s.formula, s.port, timeout, s.formula)
}

func (s *Server) ping(ctx context.Context) bool {
	out, err := exec.CommandContext(ctx, "redis-cli", "-h", "127.0.0.1", "-p", fmt.Sprint(s.port), "ping").Output()
	return err == nil && len(out) >= 4 && string(out[:4]) == "PONG"
}

// Port returns the configured port.
func (s *Server) Port() int { return s.port }

// Running reports whether a server answers right now.
func (s *Server) Running() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	return s.ping(ctx)
}

// Health pings the server and returns a one-line status including its memory
// footprint against the applied ceiling.
func (s *Server) Health(ctx context.Context) (bool, string) {
	if !s.ping(ctx) {
		return false, fmt.Sprintf("not answering on :%d (brew services info %s)", s.port, s.formula)
	}
	detail := fmt.Sprintf("up on :%d (%s)", s.port, s.formula)
	if mem := s.memoryUse(ctx); mem != "" {
		detail += ", " + mem
	}
	return true, detail
}

// memoryUse reports "used_memory / maxmemory" from INFO memory ("" if it
// cannot be read). maxmemory 0 renders as "no cap".
func (s *Server) memoryUse(ctx context.Context) string {
	out, err := exec.CommandContext(ctx, "redis-cli", "-h", "127.0.0.1", "-p", fmt.Sprint(s.port), "info", "memory").Output()
	if err != nil {
		return ""
	}
	fields := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), ":"); ok {
			fields[k] = v
		}
	}
	used := fields["used_memory_human"]
	if used == "" {
		return ""
	}
	cap_ := fields["maxmemory_human"]
	if cap_ == "" || strings.HasPrefix(cap_, "0") {
		cap_ = "no cap"
	}
	return fmt.Sprintf("memory %s of %s", used, cap_)
}

// Stop is deliberately a no-op — see the package doc.
func (s *Server) Stop() {}

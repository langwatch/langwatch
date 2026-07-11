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
	"time"
)

// Server is the brew-services-backed implementation of app.Redis.
type Server struct {
	formula string
	port    int
}

// New builds a Server. formula/port default to domain.DefaultRedisFormula /
// domain.DefaultRedisPort when empty/zero.
func New(formula string, port int) *Server {
	return &Server{formula: formula, port: port}
}

// Ensure starts the configured formula via `brew services start` unless a
// redis is already running on the configured port, then returns that port.
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
	return s.port, nil
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

// Health pings the server and returns a one-line status.
func (s *Server) Health(ctx context.Context) (bool, string) {
	if !s.ping(ctx) {
		return false, fmt.Sprintf("not answering on :%d (brew services info %s)", s.port, s.formula)
	}
	return true, fmt.Sprintf("up on :%d (%s)", s.port, s.formula)
}

// Stop is deliberately a no-op — see the package doc.
func (s *Server) Stop() {}

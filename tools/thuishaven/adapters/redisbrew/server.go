// Package redisbrew implements app.Redis: ensures ONE shared Redis is running
// via `brew services` (macOS). Unlike ClickHouse and Postgres, Redis needs no
// per-slug database — domain.RedisDBForSlug already partitions worktrees by DB
// index on the one server (see domain/slug.go) — so this adapter's only job is
// making sure a server exists to point REDIS_URL at.
//
// The server is Valkey or Redis, whichever the machine has (domain.RedisFormulas);
// Valkey is a drop-in, so everything below speaks to either.
//
// Same philosophy as Postgres: a brew-managed Redis is a machine-wide resource
// other local work may already depend on, so an already-running redis or
// valkey service is adopted rather than restarted — though Ensure still applies
// (or clears) the maxmemory ceiling on it — and Stop is a no-op.
package redisbrew

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Server is the brew-services-backed implementation of app.Redis.
type Server struct {
	// formula is the one HAVEN_REDIS_FORMULA names; "" means haven picks
	// between valkey and redis by what the machine has (domain.ChooseRedisFormula).
	formula     string
	port        int
	maxMemoryMB int
}

// New builds a Server for the given formula/port/cap as-is; defaulting to
// domain.DefaultRedisPort / domain.DefaultRedisMaxMemoryMB happens at the
// composition root (cmd/root.go), not here. An empty formula picks valkey or
// redis by what is installed. maxMemoryMB 0 means no cap.
func New(formula string, port, maxMemoryMB int) *Server {
	return &Server{formula: formula, port: port, maxMemoryMB: maxMemoryMB}
}

// Ensure starts the formula via `brew services start` unless a server is
// already answering on the configured port, applies the maxmemory ceiling,
// then returns that port.
func (s *Server) Ensure(ctx context.Context) (int, error) {
	if _, err := exec.LookPath("brew"); err != nil {
		return 0, fmt.Errorf("brew is not installed — haven manages Redis via `brew services` (install: https://brew.sh)")
	}
	formula := s.formula
	if !s.ping(ctx) {
		var installed bool
		if formula == "" {
			formula, installed = chooseFormula(ctx)
		} else {
			installed = isInstalled(ctx, formula)
		}
		if !installed {
			// A cancelled context kills the probe too, so a failed `brew list`
			// only means "not installed" when the context is still alive —
			// otherwise the honest answer is that we never got to look.
			if ctxErr := ctx.Err(); ctxErr != nil {
				return 0, fmt.Errorf("could not check whether %s is installed: %w", formula, ctxErr)
			}
			return 0, fmt.Errorf("%s is not installed — `brew install %s` (or set HAVEN_REDIS_FORMULA to a formula you already have)", formula, formula)
		}
		if err := exec.CommandContext(ctx, "brew", "services", "start", formula).Run(); err != nil {
			return 0, fmt.Errorf("brew services start %s: %w", formula, err)
		}
	}
	if err := s.waitReady(ctx, formula, 15*time.Second); err != nil {
		return 0, err
	}
	if err := s.applyMemoryCap(ctx); err != nil {
		return 0, err
	}
	return s.port, nil
}

// chooseFormula asks brew which of valkey and redis is installed and which
// service it already reports started. A probe that fails reads as "no", so
// the worst case is the default formula and Ensure's "not installed".
// It also reports whether the chosen formula is installed.
func chooseFormula(ctx context.Context) (string, bool) {
	installed := map[string]bool{}
	for _, formula := range domain.RedisFormulas {
		installed[formula] = isInstalled(ctx, formula)
	}
	started := ""
	if out, err := exec.CommandContext(ctx, "brew", "services", "list").Output(); err == nil {
		started = domain.StartedRedisFormula(string(out))
	}
	chosen := domain.ChooseRedisFormula(installed, started)
	return chosen, installed[chosen] || chosen == started
}

func isInstalled(ctx context.Context, formula string) bool {
	return exec.CommandContext(ctx, "brew", "list", "--formula", formula).Run() == nil
}

// CLI is the client binary haven talks to the server with: valkey-cli or
// redis-cli, whichever is on PATH. Either speaks to either server.
func CLI() string {
	for _, name := range domain.RedisCLIs {
		if _, err := exec.LookPath(name); err == nil {
			return name
		}
	}
	return domain.RedisCLIs[len(domain.RedisCLIs)-1]
}

// command runs one client command against the configured port.
func (s *Server) command(ctx context.Context, args ...string) *exec.Cmd {
	//nolint:gosec // every argument is a constant or a number from haven's own config
	return exec.CommandContext(ctx, CLI(), append([]string{"-h", "127.0.0.1", "-p", fmt.Sprint(s.port)}, args...)...)
}

// applyMemoryCap sets maxmemory on the running server so a leaky stack fails
// loudly at the ceiling instead of paging the machine. The eviction policy is
// deliberately left alone: the default noeviction is the only policy safe for
// BullMQ queues. maxMemoryMB <= 0 actively clears the ceiling (`config set
// maxmemory 0`) so disabling via HAVEN_REDIS_MAXMEMORY_MB=0 also undoes a cap
// a previous Ensure applied. Failures propagate: a redis that refuses CONFIG
// SET (renamed command, protected mode) fails Ensure rather than silently
// running uncapped — set HAVEN_REDIS_MAXMEMORY_MB=0 to skip the cap.
func (s *Server) applyMemoryCap(ctx context.Context) error {
	target := fmt.Sprintf("%dmb", s.maxMemoryMB)
	if s.maxMemoryMB <= 0 {
		target = "0"
	}
	out, err := s.command(ctx, "config", "set", "maxmemory", target).CombinedOutput()
	reply := strings.TrimSpace(string(out))
	if err == nil && strings.HasPrefix(reply, "OK") {
		return nil
	}
	detail := reply
	if err != nil {
		detail = fmt.Sprintf("%v: %s", err, reply)
	}
	if s.maxMemoryMB <= 0 {
		return fmt.Errorf("redis on :%d refused `config set maxmemory 0` (clearing a previously applied ceiling): %s", s.port, detail)
	}
	return fmt.Errorf("redis on :%d refused the %s memory ceiling (`config set maxmemory`): %s — set HAVEN_REDIS_MAXMEMORY_MB=0 to run without a cap", s.port, target, detail)
}

// waitReady polls until the server answers. formula is the one Ensure
// started, or "" when it adopted a server already answering.
func (s *Server) waitReady(ctx context.Context, formula string, timeout time.Duration) error {
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
	if formula == "" {
		formula = domain.DefaultRedisFormula
	}
	return fmt.Errorf("redis (%s) did not become ready on :%d within %s — check `brew services info %s`",
		formula, s.port, timeout, formula)
}

func (s *Server) ping(ctx context.Context) bool {
	out, err := s.command(ctx, "ping").Output()
	return err == nil && len(out) >= 4 && string(out[:4]) == "PONG"
}

// FlushDB empties one logical database with FLUSHDB; other databases are untouched.
func (s *Server) FlushDB(ctx context.Context, db int) error {
	out, err := s.command(ctx, "-n", fmt.Sprint(db), "flushdb").CombinedOutput()
	if reply := strings.TrimSpace(string(out)); err != nil || !strings.HasPrefix(reply, "OK") {
		return fmt.Errorf("redis flushdb on db %d: %v: %s", db, err, reply)
	}
	return nil
}

// Port returns the configured port.
func (s *Server) Port() int { return s.port }

// Running reports whether a server answers right now.
func (s *Server) Running() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	return s.ping(ctx)
}

// healthFormula names the formula for a health line: the configured one, else
// the one brew has, since cmd/root.go leaves the configured formula empty.
func (s *Server) healthFormula(ctx context.Context) string {
	if s.formula != "" {
		return s.formula
	}
	formula, _ := chooseFormula(ctx)
	return formula
}

// Health pings the server and returns a one-line status naming which server
// answered (valkey or redis) and its memory footprint against the ceiling.
func (s *Server) Health(ctx context.Context) (bool, string) {
	if !s.ping(ctx) {
		return false, fmt.Sprintf("not answering on :%d (brew services info %s)", s.port, s.healthFormula(ctx))
	}
	name, mem := s.serverInfo(ctx)
	if name == "" {
		name = s.healthFormula(ctx)
	}
	detail := fmt.Sprintf("up on :%d", s.port)
	if name != "" {
		detail += " (" + name + ")"
	}
	if mem != "" {
		detail += ", " + mem
	}
	return true, detail
}

// serverInfo reads INFO once and returns which server answered ("valkey
// 9.1.2", "redis 8.2.1") and "used_memory of maxmemory"; either is "" when
// it cannot be read.
func (s *Server) serverInfo(ctx context.Context) (name, memory string) {
	out, err := s.command(ctx, "info").Output()
	if err != nil {
		return "", ""
	}
	fields := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), ":"); ok {
			fields[k] = v
		}
	}
	return domain.RedisServerName(fields), memoryUse(fields)
}

// memoryUse renders used_memory against maxmemory; maxmemory 0 is "no cap".
func memoryUse(fields map[string]string) string {
	used := fields["used_memory_human"]
	if used == "" {
		return ""
	}
	ceiling := fields["maxmemory_human"]
	if ceiling == "" || strings.HasPrefix(ceiling, "0") {
		ceiling = "no cap"
	}
	return fmt.Sprintf("memory %s of %s", used, ceiling)
}

// Stop is deliberately a no-op — see the package doc.
func (s *Server) Stop() {}

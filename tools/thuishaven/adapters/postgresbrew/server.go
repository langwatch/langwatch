// Package postgresbrew implements app.Postgres: ONE shared Postgres server
// managed via `brew services` (macOS), with a database per worktree slug —
// the same per-slug-database-on-one-shared-server pattern as ClickHouse.
//
// Unlike ClickHouse and the observability stack, haven does not own this
// server's full lifecycle: a brew-managed Postgres is a machine-wide resource
// other, unrelated local work may already depend on (verified in practice —
// a contributor's machine can easily have a postgresql@14 already running for
// something else entirely). So Ensure reuses whatever postgresql@NN service is
// already running rather than forcing a specific version, and Stop is
// deliberately a no-op: haven never stops a service it did not start and that
// other processes may be using.
package postgresbrew

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Server is the brew-services-backed implementation of app.Postgres.
type Server struct {
	formula string // brew formula to start when none is already running
	port    int
}

// New builds a Server. formula defaults to domain.DefaultPostgresFormula when
// empty; port defaults to domain.DefaultPostgresPort.
func New(formula string, port int) *Server {
	if formula == "" {
		formula = domain.DefaultPostgresFormula
	}
	if port == 0 {
		port = domain.DefaultPostgresPort
	}
	return &Server{formula: formula, port: port}
}

// Ensure starts the configured formula via `brew services start` unless a
// postgresql@NN service is already running (any version — reused as-is, never
// resized or reconfigured), then ensures the shared PostgresRole exists.
// Returns the loopback port every worktree's DATABASE_URL connects to.
func (s *Server) Ensure(ctx context.Context) (int, error) {
	if _, err := exec.LookPath("brew"); err != nil {
		return 0, fmt.Errorf("brew is not installed — haven manages Postgres via `brew services` (install: https://brew.sh)")
	}

	if isRunning, _ := runningPostgresFormula(ctx); !isRunning {
		if err := s.start(ctx); err != nil {
			return 0, err
		}
	}

	if err := s.waitReady(ctx, 30*time.Second); err != nil {
		return 0, err
	}
	if err := s.ensureRole(ctx); err != nil {
		return 0, err
	}
	return s.port, nil
}

func (s *Server) start(ctx context.Context) error {
	if err := exec.CommandContext(ctx, "brew", "list", "--formula", s.formula).Run(); err != nil {
		// A cancelled context kills the probe too, so a failed `brew list`
		// only means "not installed" when the context is still alive —
		// otherwise the honest answer is that we never got to look.
		if ctxErr := ctx.Err(); ctxErr != nil {
			return fmt.Errorf("could not check whether %s is installed: %w", s.formula, ctxErr)
		}
		return fmt.Errorf("%s is not installed — `brew install %s` (or set HAVEN_PG_FORMULA to a version you already have)", s.formula, s.formula)
	}
	if err := exec.CommandContext(ctx, "brew", "services", "start", s.formula).Run(); err != nil {
		return fmt.Errorf("brew services start %s: %w", s.formula, err)
	}
	return nil
}

// runningPostgresFormula reports whether ANY postgresql@NN brew service is
// already started, and which one — so a second worktree (or a contributor who
// already runs Postgres for other work) is reused rather than fought over the
// same port.
var postgresFormulaLine = regexp.MustCompile(`^(postgresql(@\d+)?)\s+started\b`)

func runningPostgresFormula(ctx context.Context) (bool, string) {
	out, err := exec.CommandContext(ctx, "brew", "services", "list").Output()
	if err != nil {
		return false, ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if m := postgresFormulaLine.FindStringSubmatch(line); m != nil {
			return true, m[1]
		}
	}
	return false, ""
}

func (s *Server) waitReady(ctx context.Context, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if s.ready(ctx) {
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("postgres (%s) did not become ready on :%d within %s — check `brew services info %s`",
		s.formula, s.port, timeout, s.formula)
}

func (s *Server) ready(ctx context.Context) bool {
	return exec.CommandContext(ctx, "pg_isready", "-h", "127.0.0.1", "-p", fmt.Sprint(s.port)).Run() == nil
}

// ensureRole creates the shared role every stack's DATABASE_URL connects as, if
// it does not already exist. Idempotent: `CREATE ROLE` has no IF NOT EXISTS, so
// existence is checked first via pg_roles.
func (s *Server) ensureRole(ctx context.Context) error {
	exists, err := s.queryBool(ctx, "postgres",
		fmt.Sprintf("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %s)", quoteLiteral(domain.PostgresRole)))
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	sql := fmt.Sprintf("CREATE ROLE %s WITH LOGIN CREATEDB PASSWORD %s",
		quoteIdent(domain.PostgresRole), quoteLiteral(domain.PostgresRolePassword))
	return s.exec(ctx, "postgres", sql)
}

// EnsureDatabase creates a stack's database (owned by PostgresRole) if it does
// not already exist. Postgres has no `CREATE DATABASE IF NOT EXISTS`, so
// existence is checked first.
func (s *Server) EnsureDatabase(ctx context.Context, database string) error {
	exists, err := s.queryBool(ctx, "postgres",
		fmt.Sprintf("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = %s)", quoteLiteral(database)))
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	return s.exec(ctx, "postgres", fmt.Sprintf("CREATE DATABASE %s OWNER %s", quoteIdent(database), quoteIdent(domain.PostgresRole)))
}

// DropDatabase removes a stack's database. WITH (FORCE) terminates any
// lingering connections first: a database being dropped has no legitimate
// readers left (a stale dev server holding a pool open must not block the
// drop), and plain DROP DATABASE refuses while anything is connected.
func (s *Server) DropDatabase(ctx context.Context, database string) error {
	return s.exec(ctx, "postgres", "DROP DATABASE IF EXISTS "+quoteIdent(database)+" WITH (FORCE)")
}

// Databases lists the lw_* databases currently on the server.
func (s *Server) Databases(ctx context.Context) ([]string, error) {
	out, err := s.query(ctx, "postgres", "SELECT datname FROM pg_database WHERE datname LIKE 'lw\\_%' ORDER BY datname")
	if err != nil {
		return nil, err
	}
	var dbs []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			dbs = append(dbs, line)
		}
	}
	return dbs, nil
}

// Port returns the configured port (0 only if never constructed via New).
func (s *Server) Port() int { return s.port }

// Running reports whether a server answers on the configured port right now.
func (s *Server) Running() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return s.ready(ctx)
}

// Health pings the server and returns a one-line status. The formula named is
// whatever is actually running (live-detected), not necessarily s.formula —
// each `haven postgres` invocation is a fresh process, so a formula another
// invocation started (or that was already running) isn't remembered in s.
func (s *Server) Health(ctx context.Context) (bool, string) {
	formula := s.formula
	if isRunning, active := runningPostgresFormula(ctx); isRunning {
		formula = active
	}
	if !s.ready(ctx) {
		return false, fmt.Sprintf("not answering on :%d (brew services info %s)", s.port, formula)
	}
	dbs, _ := s.Databases(ctx)
	return true, fmt.Sprintf("up on :%d (%s), %d stack database(s)", s.port, formula, len(dbs))
}

// Stop is deliberately a no-op. A brew-managed Postgres is a machine-wide
// resource haven did not necessarily start and other local work may depend on
// (verified in practice: a contributor's machine can have a postgresql@NN
// already running for something unrelated) — haven only ever creates and drops
// its own per-slug databases on it.
func (s *Server) Stop() {}

// --- SQL helpers -------------------------------------------------------------

// exec runs a statement via psql against maintenanceDB. Connects over the
// loopback TCP port (not the Unix socket) so it exercises the exact path the
// app's own DATABASE_URL will use.
func (s *Server) exec(ctx context.Context, maintenanceDB, sql string) error {
	_, err := s.query(ctx, maintenanceDB, sql)
	return err
}

func (s *Server) query(ctx context.Context, maintenanceDB, sql string) (string, error) {
	cmd := exec.CommandContext(ctx, "psql",
		"-h", "127.0.0.1", "-p", fmt.Sprint(s.port), "-d", maintenanceDB,
		"-v", "ON_ERROR_STOP=1", "-qtA", "-c", sql,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("psql: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

func (s *Server) queryBool(ctx context.Context, maintenanceDB, sql string) (bool, error) {
	out, err := s.query(ctx, maintenanceDB, sql)
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(out) == "t", nil
}

// quoteIdent double-quotes a Postgres identifier. haven only ever passes
// lw_<slug> or the fixed PostgresRole (validated upstream), but quoting keeps
// the DDL well-formed regardless.
func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// quoteLiteral single-quotes a Postgres string literal.
func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

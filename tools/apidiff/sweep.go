package apidiff

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	sweepPrefix      = "apidiff_"
	runPIDFile       = "run.pid"
	defaultSweepDays = 2
)

var safeDatabaseName = regexp.MustCompile(`^[a-z0-9_]+$`)

// sweepCandidate is one apidiff_* database and when the server created it.
type sweepCandidate struct {
	name    string
	created time.Time
}

// runIDOfDatabase returns the run id inside apidiff_<runid>_<branch|main>.
// A name outside that shape is not ours to touch.
func runIDOfDatabase(name string) (string, bool) {
	rest, ok := strings.CutPrefix(name, sweepPrefix)
	if !ok || !safeDatabaseName.MatchString(name) {
		return "", false
	}
	for _, side := range []string{"_branch", "_main"} {
		if id, ok := strings.CutSuffix(rest, side); ok && id != "" {
			return id, true
		}
	}
	return "", false
}

// staleSelection is what selectStaleDatabases decides over.
type staleSelection struct {
	candidates []sweepCandidate
	now        time.Time
	maxAge     time.Duration
	liveRuns   map[string]bool
}

// selectStaleDatabases picks the databases a sweep drops: apidiff-shaped,
// older than maxAge, and whose run is not in liveRuns (the current run is
// part of liveRuns).
func selectStaleDatabases(s staleSelection) []string {
	candidates, now, maxAge, liveRuns := s.candidates, s.now, s.maxAge, s.liveRuns
	var stale []string
	for _, candidate := range candidates {
		id, ok := runIDOfDatabase(candidate.name)
		if !ok || liveRuns[id] || now.Sub(candidate.created) < maxAge {
			continue
		}
		stale = append(stale, candidate.name)
	}
	return stale
}

// writeRunPID records the live run: its work root holds the owning pid.
func writeRunPID(workRoot string) error {
	return os.WriteFile(filepath.Join(workRoot, runPIDFile), []byte(strconv.Itoa(os.Getpid())+"\n"), 0o600)
}

// liveRunIDs reads every .apidiff/<run>/run.pid under root and returns the
// run ids whose process is still alive. A run with a -work-root outside
// .apidiff is not seen; the age floor is what protects it.
func liveRunIDs(root string, alive func(int) bool) map[string]bool {
	live := map[string]bool{}
	files, _ := filepath.Glob(filepath.Join(toolDir(root), "*", runPIDFile))
	for _, file := range files {
		content, err := os.ReadFile(file) // #nosec G304 -- a file under the tool's own .apidiff directory.
		if err != nil {
			continue
		}
		if pid, err := strconv.Atoi(strings.TrimSpace(string(content))); err == nil && pid > 0 && alive(pid) {
			live[RunID(filepath.Dir(file))] = true
		}
	}
	return live
}

// parseSweepCandidates reads "name|epoch" lines from psql -tA.
func parseSweepCandidates(output string) []sweepCandidate {
	var candidates []sweepCandidate
	for line := range strings.SplitSeq(output, "\n") {
		name, epoch, ok := strings.Cut(strings.TrimSpace(line), "|")
		seconds, err := strconv.ParseInt(epoch, 10, 64)
		if !ok || err != nil {
			continue
		}
		candidates = append(candidates, sweepCandidate{name: name, created: time.Unix(seconds, 0)})
	}
	return candidates
}

// sweepStaleDatabases drops (or, with dryRun, lists) apidiff_* databases on
// the Postgres server that are older than maxAge and owned by no live run.
func (state *bootState) sweepStaleDatabases(ctx context.Context, maxAge time.Duration, dryRun bool) error {
	// The database's creation time is the mtime of its PG_VERSION file.
	output, err := state.pgQuery(ctx, `SELECT datname || '|' || extract(epoch from (pg_stat_file('base/' || oid || '/PG_VERSION')).modification)::bigint FROM pg_database WHERE datname LIKE 'apidiff\_%'`)
	if err != nil {
		return fmt.Errorf("sweep: list databases: %w", err)
	}
	live := liveRunIDs(state.cfg.BranchDir, processAlive)
	if state.runID != "" {
		live[state.runID] = true
	}
	for _, database := range selectStaleDatabases(staleSelection{candidates: parseSweepCandidates(output), now: time.Now(), maxAge: maxAge, liveRuns: live}) {
		if dryRun {
			state.logf("sweep: would drop %s", database)
			continue
		}
		state.logf("sweep: drop %s", database)
		if err := state.pgAdmin(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", database)); err != nil {
			return fmt.Errorf("sweep: drop %s: %w", database, err)
		}
	}
	return nil
}

// runSweepSubcommand is `apidiff -sweep-databases`.
func runSweepSubcommand(ctx context.Context, args []string, out streams) int {
	flags := flag.NewFlagSet("apidiff -sweep-databases", flag.ContinueOnError)
	flags.SetOutput(out.stderr)
	cfg := BootConfig{}
	days := flags.Int("sweep-days", defaultSweepDays, "drop apidiff_* databases older than this many days")
	flags.StringVar(&cfg.BranchDir, "branch-dir", ".", "checkout whose .apidiff directory records the live runs")
	flags.StringVar(&cfg.PGURL, "pg-url", "", "Postgres server URL (default haven's host server)")
	flags.BoolVar(&cfg.DryRun, "dry-run", false, "print the databases that would be dropped and drop none")
	if err := flags.Parse(args); err != nil {
		return exitError
	}
	state := &bootState{cfg: cfg, stderr: out.stderr, run: execRunner, hostPostgres: true}
	state.infra.pgServer = cfg.PGURL
	if state.infra.pgServer == "" {
		state.infra.pgServer = hostPostgresURL
	}
	if err := state.sweepStaleDatabases(ctx, time.Duration(*days)*24*time.Hour, cfg.DryRun); err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}
	return exitEqual
}

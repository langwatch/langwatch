package apidiff

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
)

const (
	// hostClickHouseURL is the fallback when no haven names its ClickHouse.
	hostClickHouseURL = "http://" + chUser + ":" + chPass + "@127.0.0.1:8123"
	sweepPrefix       = "apidiff_"
	runPIDFile        = "run.pid"
	defaultSweepDays  = 2
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
// the Postgres server and, when one is known, the ClickHouse server that are
// older than maxAge and owned by no live run.
func (state *bootState) sweepStaleDatabases(ctx context.Context, maxAge time.Duration, dryRun bool) error {
	live := liveRunIDs(state.cfg.BranchDir, processAlive)
	if state.runID != "" {
		live[state.runID] = true
	}
	// The database's creation time is the mtime of its PG_VERSION file.
	pg := serverSweep{
		kind:  "postgres",
		list:  `SELECT datname || '|' || extract(epoch from (pg_stat_file('base/' || oid || '/PG_VERSION')).modification)::bigint FROM pg_database WHERE datname LIKE 'apidiff\_%'`,
		query: state.pgQuery,
		drop: func(ctx context.Context, name string) error {
			return state.pgAdmin(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", name))
		},
	}
	errs := []error{state.sweepServer(ctx, pg, sweepPolicy{maxAge: maxAge, live: live, dryRun: dryRun})}
	if state.infra.chServer != "" {
		// ClickHouse has no database creation time; the oldest table stands in
		// (an empty database holds nothing and is left alone).
		ch := serverSweep{
			kind:  "clickhouse",
			list:  `SELECT concat(database, '|', toString(toUnixTimestamp(min(metadata_modification_time)))) FROM system.tables WHERE database LIKE 'apidiff\\_%' GROUP BY database`,
			query: state.chQuery,
			drop: func(ctx context.Context, name string) error {
				return state.chAdmin(ctx, "DROP DATABASE IF EXISTS "+name+" SYNC")
			},
		}
		errs = append(errs, state.sweepServer(ctx, ch, sweepPolicy{maxAge: maxAge, live: live, dryRun: dryRun}))
	}
	return errors.Join(errs...)
}

// serverSweep is how to list and drop apidiff_* databases on one server.
type serverSweep struct {
	kind  string
	list  string
	query func(context.Context, string) (string, error)
	drop  func(context.Context, string) error
}

// sweepPolicy is which databases count as stale and whether to drop them.
type sweepPolicy struct {
	maxAge time.Duration
	live   map[string]bool
	dryRun bool
}

func (state *bootState) sweepServer(ctx context.Context, server serverSweep, policy sweepPolicy) error {
	output, err := server.query(ctx, server.list)
	if err != nil {
		return fmt.Errorf("sweep: list %s databases: %w", server.kind, err)
	}
	for _, database := range selectStaleDatabases(staleSelection{candidates: parseSweepCandidates(output), now: time.Now(), maxAge: policy.maxAge, liveRuns: policy.live}) {
		if policy.dryRun {
			state.logf("sweep: would drop %s %s", server.kind, database)
			continue
		}
		state.logf("sweep: drop %s %s", server.kind, database)
		if err := server.drop(ctx, database); err != nil {
			return fmt.Errorf("sweep: drop %s %s: %w", server.kind, database, err)
		}
	}
	return nil
}

// havenClickHouseServer is the ClickHouse server (no database) haven's
// overlay names in CLICKHOUSE_URL, with its credentials, so a native server on
// another port is found. Empty when haven is absent or names none.
func havenClickHouseServer(ctx context.Context, dir string) string {
	if !havenrun.OnPath() {
		return ""
	}
	command := exec.CommandContext(ctx, havenrun.Command, "env", "--json", "--reveal") //nolint:gosec // fixed haven binary and arguments
	command.Dir = dir
	out, err := command.Output()
	if err != nil {
		return ""
	}
	overlay := map[string]string{}
	if json.Unmarshal(out, &overlay) != nil {
		return ""
	}
	return clickHouseServerOf(overlay["CLICKHOUSE_URL"])
}

// clickHouseServerOf drops the database path from a CLICKHOUSE_URL.
func clickHouseServerOf(raw string) string {
	parsed, err := url.Parse(raw)
	if raw == "" || err != nil || parsed.Host == "" {
		return ""
	}
	parsed.Path, parsed.RawQuery = "", ""
	return parsed.String()
}

// resolveClickHouseServer prefers the explicit URL, then haven's, then the
// constant.
func resolveClickHouseServer(explicit, fromHaven string) string {
	return cmp.Or(explicit, fromHaven, hostClickHouseURL)
}

// sweepOnHaven sweeps the host servers on the haven path, which never reaches
// prepareDatabases. A failed sweep is logged and never fails the run.
func (state *bootState) sweepOnHaven(ctx context.Context) {
	if state.cfg.SweepDays <= 0 {
		return
	}
	state.hostPostgres = true
	state.infra.pgServer = cmp.Or(state.infra.pgServer, hostPostgresURL)
	state.infra.chServer = resolveClickHouseServer(state.infra.chServer, havenClickHouseServer(ctx, state.cfg.BranchDir))
	if err := state.sweepStaleDatabases(ctx, time.Duration(state.cfg.SweepDays)*24*time.Hour, false); err != nil {
		state.logf("%v", err)
	}
}

// runSweepSubcommand is `apidiff -sweep-databases`.
func runSweepSubcommand(ctx context.Context, args []string, out streams) int {
	flags := flag.NewFlagSet("apidiff -sweep-databases", flag.ContinueOnError)
	flags.SetOutput(out.stderr)
	cfg := BootConfig{}
	days := flags.Int("sweep-days", defaultSweepDays, "drop apidiff_* databases older than this many days")
	flags.StringVar(&cfg.BranchDir, "branch-dir", ".", "checkout whose .apidiff directory records the live runs")
	flags.StringVar(&cfg.PGURL, "pg-url", "", "Postgres server URL (default haven's host server)")
	flags.StringVar(&cfg.CHURL, "ch-url", "", "ClickHouse server URL (default haven's host server)")
	flags.BoolVar(&cfg.DryRun, "dry-run", false, "print the databases that would be dropped and drop none")
	if err := flags.Parse(args); err != nil {
		return exitError
	}
	state := &bootState{cfg: cfg, stderr: out.stderr, run: execRunner, hostPostgres: true}
	state.infra.pgServer = cfg.PGURL
	if state.infra.pgServer == "" {
		state.infra.pgServer = hostPostgresURL
	}
	state.infra.chServer = resolveClickHouseServer(cfg.CHURL, havenClickHouseServer(ctx, cfg.BranchDir))
	if err := state.sweepStaleDatabases(ctx, time.Duration(*days)*24*time.Hour, cfg.DryRun); err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}
	return exitEqual
}

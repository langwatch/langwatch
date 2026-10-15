package cell

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/snapshot"
)

// TaskDrillKillMidStep (UD-1, cloud gap G1-1): head's worker is killed while a checkpointing background
// step is running with a checkpoint saved; the restarted worker must resume from it, not from zero,
// and the stores must match a clean run's. The killed step at "blocking step started" (kill-blocking)
// lands after a step of a few milliseconds has finished, so it never proved a resume.
const TaskDrillKillMidStep = "kill-mid-step"

// midStepOptions picks the step, the rows planted on main so it runs for seconds, and the fact it writes.
type midStepOptions struct {
	step          string // a background step that saves a checkpoint per page
	checkpointKey string // the checkpoint's cursor field
	countKey      string // the report's row count, a total across attempts
	pageSize      int    // rows the step counts between two checkpoints
	plantUsers    int    // accounts planted on main before head runs
	factEvent     string // the event the step records, one per row
}

var defaultMidStep = midStepOptions{step: "user:record-created-facts", checkpointKey: "afterUserId", countKey: "users", pageSize: 2000, plantUsers: 40000, factEvent: "lw.user.created"}

// stepRow is one ledger row's status and report, read straight from Postgres.
type stepRow struct {
	status string
	report map[string]any
}

func (row stepRow) cursor(key string) string {
	value, _ := row.report[key].(string)
	return value
}

func (row stepRow) count(key string) int {
	value, _ := row.report[key].(float64)
	return int(value)
}

// parseStepRow reads `status|report` as psql -At prints it.
func parseStepRow(out string) stepRow {
	status, report, _ := strings.Cut(strings.TrimSpace(out), "|")
	row := stepRow{status: status}
	_ = json.Unmarshal([]byte(report), &row.report)
	return row
}

func (cell *run) readStep(ctx context.Context, id string) (stepRow, error) {
	out, err := psql(ctx, cell.stores.psqlURL(), `SELECT status, coalesce(report::text, '') FROM mydb_upgrade_ledger._langwatch_upgrade_step WHERE id = '`+strings.ReplaceAll(id, "'", "")+`'`)
	return parseStepRow(out), err
}

// killMoment is what the ledger said when the kill landed and right after the worker died.
type killMoment struct {
	at, after  stepRow
	firstAfter stepRow // the first checkpoint the restarted worker saved
	missed     bool    // the step finished before a running row with a checkpoint was seen
	death      deathProof
}

// deathProof is what shows the killed worker really ended: no signaled pid survives and its log
// names only pids that were signaled, with no line stamped after the kill.
type deathProof struct {
	killedAt   time.Time
	killed     []int // the leader and every descendant, signaled with SIGKILL
	survivors  []int // signaled pids still running once the wait ended
	loggedPids []int // pids the killed worker's log lines carry
	linesAfter int   // log lines stamped after the kill
}

func (proof deathProof) died() bool {
	if len(proof.killed) == 0 || len(proof.survivors) > 0 || len(proof.loggedPids) == 0 || proof.linesAfter > 0 {
		return false
	}
	for _, pid := range proof.loggedPids {
		if !slices.Contains(proof.killed, pid) {
			return false
		}
	}
	return true
}

func (proof deathProof) String() string {
	return fmt.Sprintf("signaled pids %v, still running %v, pids in its log %v, log lines after the kill %d", proof.killed, proof.survivors, proof.loggedPids, proof.linesAfter)
}

// readWorkerLog lists the pids a worker's JSON log lines carry and counts the lines stamped after killedAt.
func readWorkerLog(text string, killedAt time.Time) (pids []int, linesAfter int) {
	for _, line := range strings.Split(text, "\n") {
		var entry struct {
			Pid  int    `json:"pid"`
			Time string `json:"time"`
		}
		if json.Unmarshal([]byte(line), &entry) != nil || entry.Pid == 0 {
			continue
		}
		if !slices.Contains(pids, entry.Pid) {
			pids = append(pids, entry.Pid)
		}
		if at, err := time.Parse(time.RFC3339Nano, entry.Time); err == nil && at.After(killedAt) {
			linesAfter++
		}
	}
	return pids, linesAfter
}

// pollLedger is waitFor at a tenth of a second: a page of the step takes about a second.
func pollLedger(ctx context.Context, within time.Duration, done func() bool) error {
	deadline := time.Now().Add(within)
	for !done() {
		if time.Now().After(deadline) {
			return fmt.Errorf("not reached within %s", within)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return nil
}

// killMayLand: the step is running and has saved a checkpoint, so a kill now lands mid-step.
func killMayLand(row stepRow, key string) bool {
	return row.status == "running" && row.cursor(key) != ""
}

// midStepRun is one upgrade of restored stores: planted rows, head's upgrade task, then head's worker
// for the background steps; with kill, the worker is killed mid-step once and started again.
type midStepRun struct {
	kill        killMoment
	final       stepRow
	planted     string // the User table's row count once planted
	resumeLines []string
	facts       string // count, distinct rows and hash of the step's events
	duplicates  string // event rows written twice before the store merged them
	state       upgraded
}

func plantUsersSQL(count int) string {
	return fmt.Sprintf(`INSERT INTO mydb."User" (id, email, name, "createdAt", "updatedAt")
SELECT 'gap1user' || lpad(g::text, 7, '0'), 'gap1-' || g || '@snapshot.test', 'Planted ' || g,
       timestamp '2026-01-01' + g * interval '1 second', timestamp '2026-01-01' + g * interval '1 second'
FROM generate_series(1, %d) AS g ON CONFLICT DO NOTHING`, count)
}

// midStepPass names one run's logs and says whether it kills the worker.
type midStepPass struct {
	name string
	kill bool
}

func (cell *run) runMidStep(ctx context.Context, options midStepOptions, pass midStepPass) (midStepRun, error) {
	name, kill := pass.name, pass.kill
	var result midStepRun
	if err := cell.restoreFresh(ctx); err != nil {
		return result, err
	}
	if _, err := psql(ctx, cell.stores.psqlURL(), plantUsersSQL(options.plantUsers)); err != nil {
		return result, fmt.Errorf("planting accounts: %w", err)
	}
	result.planted, _ = psql(ctx, cell.stores.psqlURL(), `SELECT count(*) FROM mydb."User"`)
	progress(name, "planted; %s accounts; running head's upgrade task", strings.TrimSpace(result.planted))
	if code, err := cell.upgradeTask(ctx, name+"-upgrade", nil); code != 0 {
		return result, fmt.Errorf("head's upgrade task exited %d: %w", code, err)
	}
	progress(name, "upgrade task finished; asserting old writers gone")
	cell.assertOldWritersGone(ctx)
	if err := cell.startHeadWorker(); err != nil {
		return result, err
	}
	defer cell.stopWorkerAs(name + "-worker")
	if err := cell.awaitWorkerBoot(ctx, name); err != nil {
		return result, err
	}
	if kill {
		var err error
		if result.kill, err = cell.killAndRestart(ctx, options, name); err != nil {
			return result, err
		}
	}
	// An attempt may pass the step's 15-minute deadline on a loaded machine and retry after a backoff.
	every := progressEvery(time.Minute)
	if err := waitFor(ctx, 60*time.Minute, func() bool {
		row, err := cell.readStep(ctx, options.step)
		every(func() {
			progress(name, "waiting for %s: %q %s=%q (%d rows)", options.step, row.status, options.checkpointKey, row.cursor(options.checkpointKey), row.count(options.countKey))
		})
		return err == nil && row.status == "done"
	}); err != nil {
		return result, fmt.Errorf("%s never finished: %w", options.step, err)
	}
	progress(name, "%s done; settling the ledger and queues (up to 25 min)", options.step)
	return cell.collectMidStep(ctx, options, result)
}

// progress prints one timestamped line to stderr, so a long wait shows what it waits on.
func progress(pass, format string, args ...any) {
	fmt.Fprintf(os.Stderr, "%s UD-1 %s: %s\n", time.Now().Format("15:04:05"), pass, fmt.Sprintf(format, args...))
}

// progressEvery runs say at most once per interval, so a poll loop's status never floods stderr.
func progressEvery(interval time.Duration) func(say func()) {
	var last time.Time
	return func(say func()) {
		if time.Since(last) >= interval {
			last = time.Now()
			say()
		}
	}
}

// awaitWorkerBoot waits for head's worker's first log line: on a loaded host node takes minutes to
// load the worker, and the kill's window must not start until it runs.
func (cell *run) awaitWorkerBoot(ctx context.Context, name string) error {
	started, every := time.Now(), progressEvery(30*time.Second)
	err := waitFor(ctx, 30*time.Minute, func() bool {
		if exited, _ := cell.proc("head-worker").Exited(); exited {
			return true
		}
		booted := strings.Contains(readText(cell.logPath("head-worker")), `"pid":`)
		every(func() {
			progress(name, "head's worker started %s ago; booted %t", time.Since(started).Round(time.Second), booted)
		})
		return booted
	})
	if exited, exitErr := cell.proc("head-worker").Exited(); exited {
		return fmt.Errorf("head's worker exited while booting (%w); see %s", exitErr, cell.logPath("head-worker"))
	}
	if err != nil {
		return fmt.Errorf("head's worker wrote no log line: %w", err)
	}
	progress(name, "head's worker booted in %s", time.Since(started).Round(time.Second))
	return nil
}

// collectMidStep reads what the finished run left: the step's row, its worker lines, its events and the stores.
func (cell *run) collectMidStep(ctx context.Context, options midStepOptions, result midStepRun) (midStepRun, error) {
	result.final, _ = cell.readStep(ctx, options.step)
	_ = waitFor(ctx, 25*time.Minute, func() bool { // settle: queue work a killed worker held must come back
		rows, err := Ledger(ctx, cell.stores)
		return err == nil && len(Outstanding(rows)) == 0 && cell.queueDrained(ctx)
	})
	worker := cell.logPath("head-worker")
	for _, line := range strings.Split(readText(worker), "\n") {
		if strings.Contains(line, "background step") && strings.Contains(line, options.step) {
			result.resumeLines = append(result.resumeLines, logMessage(line)+resumedSuffix(line))
		}
	}
	result.facts, _ = clickhouseQuery(ctx, cell.stores.queryURL(""), `SELECT count(), uniqExact(AggregateId), groupBitXor(cityHash64(AggregateId, IdempotencyKey, EventOccurredAt)) FROM event_log FINAL WHERE EventType = '`+options.factEvent+`' FORMAT TSV`)
	result.duplicates, _ = clickhouseQuery(ctx, cell.stores.queryURL(""), `SELECT count() FROM (SELECT IdempotencyKey FROM event_log WHERE EventType = '`+options.factEvent+`' GROUP BY TenantId, AggregateId, IdempotencyKey HAVING count() > 1) FORMAT TSV`)
	result.facts, result.duplicates = strings.TrimSpace(result.facts), strings.TrimSpace(result.duplicates)
	state, err := cell.upgradedState(ctx)
	result.state = state
	return result, err
}

func readText(path string) string {
	raw, _ := os.ReadFile(path) // #nosec G304 -- the cell's own log.
	return string(raw)
}

func resumedSuffix(line string) string {
	switch {
	case strings.Contains(line, `"resumed":true`):
		return " (resumed: true)"
	case strings.Contains(line, `"resumed":false`):
		return " (resumed: false)"
	}
	return ""
}

// killWhenMidStep polls the ledger every 100 ms and kills head's worker, node included, the first
// time the step is running with a checkpoint saved, then waits for every signaled pid to end.
func (cell *run) killWhenMidStep(ctx context.Context, options midStepOptions) (killMoment, error) {
	var moment killMoment
	every := progressEvery(30 * time.Second)
	err := pollLedger(ctx, 25*time.Minute, func() bool {
		row, err := cell.readStep(ctx, options.step)
		every(func() {
			progress("kill", "watching %s: %q %s=%q (%d rows), read error %v", options.step, row.status, options.checkpointKey, row.cursor(options.checkpointKey), row.count(options.countKey), err)
		})
		if err != nil {
			return false
		}
		if row.status == "done" {
			moment.missed = true
			return true
		}
		if !killMayLand(row, options.checkpointKey) {
			return false
		}
		moment.death.killed = cell.proc("head-worker").Kill()
		moment.death.killedAt = time.Now()
		moment.at = row
		return true
	})
	if err != nil || moment.missed {
		return moment, errors.Join(err, errors.New("the step finished before a kill could land mid-step: plant more rows"))
	}
	waitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = cell.proc("head-worker").Wait(waitCtx)
	_ = pollLedger(waitCtx, 10*time.Second, func() bool { return len(alive(moment.death.killed)) == 0 })
	moment.death.survivors = alive(moment.death.killed)
	moment.after, _ = cell.readStep(ctx, options.step)
	progress("kill", "killed pids %v at %s=%q (%d rows); still running %v; ledger after %q", moment.death.killed, options.checkpointKey, moment.at.cursor(options.checkpointKey), moment.at.count(options.countKey), moment.death.survivors, moment.after.status)
	return moment, nil
}

// killAndRestart kills head's worker mid-step, keeps its log, and starts a fresh one as an orchestrator would.
func (cell *run) killAndRestart(ctx context.Context, options midStepOptions, name string) (killMoment, error) {
	moment, err := cell.killWhenMidStep(ctx, options)
	if err != nil {
		return moment, err
	}
	cell.stopWorkerAs(name + "-worker-killed")
	moment.death.loggedPids, moment.death.linesAfter = readWorkerLog(readText(cell.logPath(name+"-worker-killed")), moment.death.killedAt)
	if err := cell.startHeadWorker(); err != nil {
		return moment, err
	}
	if err := cell.awaitWorkerBoot(ctx, name+" restart"); err != nil {
		return moment, err
	}
	_ = pollLedger(ctx, 10*time.Minute, func() bool { // the restarted worker's first saved checkpoint
		row, err := cell.readStep(ctx, options.step)
		moment.firstAfter = row
		return err == nil && (row.status == "done" || row.cursor(options.checkpointKey) != moment.after.cursor(options.checkpointKey))
	})
	progress(name, "restarted worker's first checkpoint: %q %s=%q (%d rows)", moment.firstAfter.status, options.checkpointKey, moment.firstAfter.cursor(options.checkpointKey), moment.firstAfter.count(options.countKey))
	return moment, nil
}

// stopWorkerAs stops head's worker if it runs, drops it from the cell's processes and keeps its log under name.
func (cell *run) stopWorkerAs(name string) {
	worker := cell.proc("head-worker")
	if worker.command == nil {
		return
	}
	worker.Stop(20 * time.Second)
	cell.procsMu.Lock()
	cell.procs = slices.DeleteFunc(cell.procs, func(proc *Proc) bool { return proc == worker })
	cell.procsMu.Unlock()
	_ = os.Rename(cell.logPath("head-worker"), cell.logPath(name))
}

// countsOnly keeps each table's row count: background steps mint event ids and timestamps per run.
func countsOnly(fingerprint snapshot.Fingerprint) snapshot.Fingerprint {
	kept := snapshot.Fingerprint{}
	for store, tables := range fingerprint {
		kept[store] = map[string]snapshot.TableFingerprint{}
		for table, each := range tables {
			kept[store][table] = snapshot.TableFingerprint{Count: each.Count}
		}
	}
	return kept
}

// midStepVerdict judges UD-1: the kill landed mid-step and really ended the worker, the restarted
// worker resumed from the checkpoint, and the run converged on what a clean run leaves. The report's
// count is a total across attempts, so each attempt's share comes from the checkpoints.
func midStepVerdict(options midStepOptions, drilled, clean midStepRun) Verdict {
	key, kill := options.checkpointKey, drilled.kill
	landed := killMayLand(kill.at, key) && kill.after.status == "running" && kill.after.cursor(key) != ""
	died := kill.death.died()
	atKill, firstAfter := kill.after.count(options.countKey), kill.firstAfter.count(options.countKey)
	total, whole := drilled.final.count(options.countKey), clean.final.count(options.countKey)
	resumed := kill.firstAfter.cursor(key) != "" && firstAfter > atKill && firstAfter-atKill <= options.pageSize
	counted := whole > 0 && total == whole
	postgresDiffs, otherDiffs := splitDiffs(countsOnly(drilled.state.fingerprint).Diff(countsOnly(clean.state.fingerprint)))
	stepDiffs := compareUpgraded(upgraded{steps: drilled.state.steps}, upgraded{steps: clean.state.steps})
	converged := drilled.facts != "" && drilled.facts == clean.facts && drilled.final.status == "done" && len(postgresDiffs) == 0 && len(stepDiffs) == 0
	return Verdict{ID: "UD-1", Name: "a worker killed mid-step resumes from the checkpoint and converges with a clean run",
		Result: passText(landed && died && resumed && counted && converged),
		Detail: fmt.Sprintf("step %s, %s accounts after planting; killed while %q with checkpoint %s=%q (%d rows), ledger after the kill %q %s=%q (%d rows); worker died %t (%s); first checkpoint the restarted worker saved %q %s=%q (%d rows, %d past the kill's; a page is %d); runner lines (it logs warnings only): %v; the killed attempt counted %d rows, the resumed one %d; report total %d, clean run %d; final checkpoint %s=%q; events (count, distinct, hash) drilled %q clean %q, written twice before merging drilled %s clean %s; Postgres count differences %v (ignored, written on the worker's own timing: %v), step status differences %v, ClickHouse count differences (not judged) %v",
			options.step, drilled.planted, kill.at.status, key, kill.at.cursor(key), kill.at.count(options.countKey), kill.after.status, key, kill.after.cursor(key), atKill,
			died, kill.death, kill.firstAfter.status, key, kill.firstAfter.cursor(key), firstAfter, firstAfter-atKill, options.pageSize,
			drilled.resumeLines, atKill, total-atKill, total, whole, key, drilled.final.cursor(key), drilled.facts, clean.facts, drilled.duplicates, clean.duplicates, postgresDiffs, workerTimedTables, stepDiffs, otherDiffs)}
}

// workerTimedTables hold rows the worker writes on its own timing (process manager sends, tenant
// migration sweeps), so a killed and restarted worker leaves a different count with nothing wrong.
var workerTimedTables = []string{"ProcessManagerOutbox", "SystemMigrationTenantState"}

// splitDiffs separates Postgres differences, less the worker-timed tables, from every other store's.
func splitDiffs(diffs []string) (postgres, other []string) {
	for _, diff := range diffs {
		table, _, _ := strings.Cut(strings.TrimPrefix(diff, "postgres/"), ":")
		if slices.Contains(workerTimedTables, table) {
			continue
		}
		if strings.HasPrefix(diff, "postgres") {
			postgres = append(postgres, diff)
		} else {
			other = append(other, diff)
		}
	}
	return postgres, other
}

func (cell *run) killMidStepDrill(ctx context.Context, options midStepOptions) (Verdict, error) {
	if err := cell.buildBoth(ctx); err != nil {
		return Verdict{}, err
	}
	drilled, err := cell.runMidStep(ctx, options, midStepPass{name: "ud1m-killed", kill: true})
	if err != nil {
		return Verdict{}, err
	}
	clean, err := cell.runMidStep(ctx, options, midStepPass{name: "ud1m-clean"})
	if err != nil {
		return Verdict{}, err
	}
	return midStepVerdict(options, drilled, clean), nil
}

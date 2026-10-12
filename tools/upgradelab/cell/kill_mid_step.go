package cell

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"syscall"
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
	countKey      string // the report's row count for this run
	plantUsers    int    // accounts planted on main before head runs
	factEvent     string // the event the step records, one per row
}

var defaultMidStep = midStepOptions{step: "user:record-created-facts", checkpointKey: "afterUserId", countKey: "users", plantUsers: 40000, factEvent: "lw.user.created"}

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
	if code, err := cell.upgradeTask(ctx, name+"-upgrade", nil); code != 0 {
		return result, fmt.Errorf("head's upgrade task exited %d: %w", code, err)
	}
	cell.assertOldWritersGone(ctx)
	if err := cell.startHeadWorker(); err != nil {
		return result, err
	}
	defer cell.stopWorkerAs(name + "-worker")
	if kill {
		var err error
		if result.kill, err = cell.killAndRestart(ctx, options, name); err != nil {
			return result, err
		}
	}
	if err := waitFor(ctx, 25*time.Minute, func() bool {
		row, err := cell.readStep(ctx, options.step)
		return err == nil && row.status == "done"
	}); err != nil {
		return result, fmt.Errorf("%s never finished: %w", options.step, err)
	}
	return cell.collectMidStep(ctx, options, result)
}

// collectMidStep reads what the finished run left: the step's row, its worker lines, its events and the stores.
func (cell *run) collectMidStep(ctx context.Context, options midStepOptions, result midStepRun) (midStepRun, error) {
	result.final, _ = cell.readStep(ctx, options.step)
	_ = waitFor(ctx, 15*time.Minute, func() bool {
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

// killWhenMidStep polls the ledger every 100 ms and kills head's worker the first time the step is
// running with a checkpoint saved.
func (cell *run) killWhenMidStep(ctx context.Context, options midStepOptions) (killMoment, error) {
	var moment killMoment
	err := waitFor(ctx, 25*time.Minute, func() bool {
		row, err := cell.readStep(ctx, options.step)
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
		cell.proc("head-worker").Signal(syscall.SIGKILL)
		moment.at = row
		return true
	})
	if err != nil || moment.missed {
		return moment, errors.Join(err, errors.New("the step finished before a kill could land mid-step: plant more rows"))
	}
	waitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = cell.proc("head-worker").Wait(waitCtx)
	moment.after, _ = cell.readStep(ctx, options.step)
	return moment, nil
}

// killAndRestart kills head's worker mid-step, keeps its log, and starts a fresh one as an orchestrator would.
func (cell *run) killAndRestart(ctx context.Context, options midStepOptions, name string) (killMoment, error) {
	moment, err := cell.killWhenMidStep(ctx, options)
	if err != nil {
		return moment, err
	}
	cell.stopWorkerAs(name + "-worker-killed")
	if err := cell.startHeadWorker(); err != nil {
		return moment, err
	}
	_ = waitFor(ctx, 10*time.Minute, func() bool { // the restarted worker's first saved checkpoint
		row, err := cell.readStep(ctx, options.step)
		moment.firstAfter = row
		return err == nil && (row.status == "done" || row.cursor(options.checkpointKey) != moment.after.cursor(options.checkpointKey))
	})
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

// midStepVerdict judges UD-1: the kill landed mid-step, the rerun resumed from the checkpoint and
// converged on what a clean run leaves.
func midStepVerdict(options midStepOptions, drilled, clean midStepRun) Verdict {
	key := options.checkpointKey
	landed := killMayLand(drilled.kill.at, key) && drilled.kill.after.status == "running" && drilled.kill.after.cursor(key) != ""
	atKill, rerun, whole := drilled.kill.after.count(options.countKey), drilled.final.count(options.countKey), clean.final.count(options.countKey)
	fromCheckpoint := rerun > 0 && rerun < whole && atKill+rerun >= whole
	postgresDiffs, otherDiffs := splitDiffs(countsOnly(drilled.state.fingerprint).Diff(countsOnly(clean.state.fingerprint)))
	stepDiffs := compareUpgraded(upgraded{steps: drilled.state.steps}, upgraded{steps: clean.state.steps})
	converged := drilled.facts != "" && drilled.facts == clean.facts && drilled.final.status == "done" && len(postgresDiffs) == 0 && len(stepDiffs) == 0
	return Verdict{ID: "UD-1", Name: "a worker killed mid-step resumes from the checkpoint and converges with a clean run",
		Result: passText(landed && fromCheckpoint && converged),
		Detail: fmt.Sprintf("step %s, %s accounts after planting; killed while %q with checkpoint %s=%q (%d rows), ledger after the kill %q %s=%q; first checkpoint the restarted worker saved %q %v; runner lines (it logs warnings only): %v; rerun counted %d rows, clean run %d; final checkpoint %s=%q; events (count, distinct, hash) drilled %q clean %q, written twice before merging drilled %s clean %s; Postgres count differences %v, step status differences %v, ClickHouse count differences (not judged) %v",
			options.step, drilled.planted, drilled.kill.at.status, key, drilled.kill.at.cursor(key), drilled.kill.at.count(options.countKey), drilled.kill.after.status, key, drilled.kill.after.cursor(key),
			drilled.kill.firstAfter.status, drilled.kill.firstAfter.report, drilled.resumeLines, rerun, whole, key, drilled.final.cursor(key), drilled.facts, clean.facts, drilled.duplicates, clean.duplicates, postgresDiffs, stepDiffs, otherDiffs)}
}

// splitDiffs separates Postgres differences from every other store's.
func splitDiffs(diffs []string) (postgres, other []string) {
	for _, diff := range diffs {
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

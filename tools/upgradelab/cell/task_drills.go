package cell

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/snapshot"
)

// Task drills run head's `pnpm task upgrade` by hand on stores restored from a snapshot (#8553 UD-1, UD-2, UD-6).
const (
	TaskDrillKill       = "kill-blocking"      // UD-1: SIGKILL at "blocking step <id> started", re-run, compare with a clean run
	TaskDrillTwoRunners = "two-runners"        // UD-6: two upgraders at once
	TaskDrillHeldLock   = "held-lock"          // UD-2: ACCESS EXCLUSIVE on the next Prisma folder's table past lock_timeout x 3
	TaskDrillFirstFail  = "first-install-fail" // UD-12: head boots on empty stores whose first Prisma folder fails
)

// blockingStarted matches the runner's line for a blocking step starting.
var blockingStarted = regexp.MustCompile(`blocking step (\S+) started`)

// DrillCommand parses `upgradelab drill`, runs one task drill and prints its verdict.
func DrillCommand(ctx context.Context, args []string, stdout io.Writer) (int, error) {
	var options Options
	flags := cellFlags("drill", &options)
	flags.StringVar(&options.FromSnapshot, "from-snapshot", "", "a produce entry directory or cache key (required)")
	name := flags.String("drill", "", "kill-blocking | kill-mid-step | two-runners | held-lock | first-install-fail")
	table := flags.String("lock-table", "", "held-lock: the table to hold (default: the first ALTER TABLE of the next pending Prisma folder)")
	midStep := defaultMidStep
	flags.StringVar(&midStep.step, "step", midStep.step, "kill-mid-step: the checkpointing background step to kill head's worker in")
	flags.IntVar(&midStep.plantUsers, "plant-users", midStep.plantUsers, "kill-mid-step: accounts planted on main so the step runs for seconds")
	holdFor := flags.Duration("hold-for", 90*time.Second, "held-lock: how long the lock is held; it must outlast the task's boot (about 20 s) and three attempts")
	if err := flags.Parse(args); err != nil {
		return 2, err
	}
	if options.FromSnapshot == "" {
		return 2, errors.New("drill needs -from-snapshot")
	}
	options.TaskDrill = *name
	options, err := withDefaults(options)
	if err != nil {
		return 2, err
	}
	if options, err = withHavenServers(ctx, options); err != nil {
		return 2, err
	}
	cell, err := prepare(options)
	if err != nil {
		return 2, err
	}
	defer cell.teardown()
	if err := cell.freshStores(ctx); err != nil {
		return 2, err
	}
	var result Verdict
	switch *name {
	case TaskDrillKill:
		result, err = cell.killBlockingDrill(ctx)
	case TaskDrillKillMidStep:
		result, err = cell.killMidStepDrill(ctx, midStep)
	case TaskDrillTwoRunners:
		result, err = cell.twoRunnersDrill(ctx)
	case TaskDrillHeldLock:
		result, err = cell.heldLockDrill(ctx, *table, *holdFor)
	case TaskDrillFirstFail:
		result, err = cell.firstInstallFailDrill(ctx)
	default:
		return 2, fmt.Errorf("unknown drill %q: want %s, %s, %s, %s or %s", *name, TaskDrillKill, TaskDrillKillMidStep, TaskDrillTwoRunners, TaskDrillHeldLock, TaskDrillFirstFail)
	}
	if err != nil {
		cell.report.Error = err.Error()
		return 2, err
	}
	cell.report.Verdicts = append(cell.report.Verdicts, result)
	fmt.Fprintf(stdout, "%s %s: %s\n", result.ID, result.Result, result.Detail)
	if result.Result != "pass" {
		return 1, nil
	}
	return 0, nil
}

// restoreFresh empties every store and loads the snapshot again.
func (cell *run) restoreFresh(ctx context.Context) error {
	if err := cell.stores.Fresh(ctx); err != nil {
		return err
	}
	if out, err := exec.CommandContext(ctx, "redis-cli", "-p", cell.stores.RedisPort, "FLUSHALL").CombinedOutput(); err != nil { // #nosec G204 -- fixed argv.
		return fmt.Errorf("redis FLUSHALL: %w: %s", err, tail(out))
	}
	return cell.restore(ctx)
}

// upgradeTask starts head's upgrade task; each output line goes to the log and to onLine.
func (cell *run) upgradeTask(ctx context.Context, logName string, onLine func(line string, proc *os.Process)) (int, error) {
	logFile, err := os.Create(cell.logPath(logName))
	if err != nil {
		return -1, err
	}
	defer func() { _ = logFile.Close() }()
	command := exec.CommandContext(ctx, "node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "src/main.ts", "upgrade") // #nosec G204 -- fixed argv.
	command.Dir, command.Env = filepath.Join(cell.options.HeadDir, "apps", "tasks"), cell.envWith(nil)
	reader, writer := io.Pipe()
	command.Stdout, command.Stderr = writer, writer
	if err := command.Start(); err != nil {
		return -1, err
	}
	scanned := make(chan struct{})
	go func() {
		defer close(scanned)
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 1<<20), 1<<22)
		for scanner.Scan() {
			_, _ = fmt.Fprintln(logFile, scanner.Text())
			if onLine != nil {
				onLine(scanner.Text(), command.Process)
			}
		}
		_, _ = io.Copy(io.Discard, reader)
	}()
	waitErr := command.Wait()
	_ = writer.Close()
	<-scanned
	return command.ProcessState.ExitCode(), waitErr
}

// killBlockingDrill (UD-1): kill at the first blocking step, re-run, then compare with a clean run.
func (cell *run) killBlockingDrill(ctx context.Context) (Verdict, error) {
	if err := cell.restoreFresh(ctx); err != nil {
		return Verdict{}, err
	}
	var killedAt, statusAtKill string
	_, _ = cell.upgradeTask(ctx, "ud1-killed", func(line string, proc *os.Process) {
		if match := blockingStarted.FindStringSubmatch(line); match != nil && killedAt == "" {
			_ = proc.Signal(syscall.SIGKILL)
			killedAt = match[1]
		}
	})
	if killedAt != "" {
		statusAtKill, _ = psql(ctx, cell.stores.psqlURL(), `SELECT status FROM mydb_upgrade_ledger._langwatch_upgrade_step WHERE id = '`+strings.ReplaceAll(killedAt, "'", "")+`'`)
	}
	rerunCode, _ := cell.upgradeTask(ctx, "ud1-rerun", nil)
	drilled, err := cell.upgradedState(ctx)
	if err != nil {
		return Verdict{}, err
	}
	if err := cell.restoreFresh(ctx); err != nil {
		return Verdict{}, err
	}
	cleanCode, _ := cell.upgradeTask(ctx, "ud1-clean", nil)
	clean, err := cell.upgradedState(ctx)
	if err != nil {
		return Verdict{}, err
	}
	diffs := compareUpgraded(drilled, clean)
	resumed := cell.logLines("ud1-rerun", killedAt)
	return Verdict{ID: "UD-1", Name: "a killed upgrade resumes and converges with a clean run",
		Result: passText(killedAt != "" && rerunCode == 0 && cleanCode == 0 && len(diffs) == 0),
		Detail: fmt.Sprintf("killed at blocking step %q (ledger then %q); re-run exit %d, clean exit %d; re-run lines naming the step: %s; differences from the clean run: %v",
			killedAt, statusAtKill, rerunCode, cleanCode, resumed, diffs)}, nil
}

// upgraded is what a finished upgrade left: the data fingerprint and each step's status.
type upgraded struct {
	fingerprint snapshot.Fingerprint
	steps       map[string]string
}

func (cell *run) upgradedState(ctx context.Context) (upgraded, error) {
	stores, err := cell.snapshotStores()
	if err != nil {
		return upgraded{}, err
	}
	fingerprint, err := snapshot.TakeFingerprint(ctx, stores)
	if err != nil {
		return upgraded{}, err
	}
	rows, err := Ledger(ctx, cell.stores)
	steps := map[string]string{}
	for i := range rows {
		row := &rows[i]
		steps[row.ID] = row.Status
	}
	return upgraded{fingerprint: withoutLedger(fingerprint), steps: steps}, err
}

// withoutLedger drops the ledger's own tables, Redis and Prisma's row ids: runs and timestamps differ by design.
func withoutLedger(fingerprint snapshot.Fingerprint) snapshot.Fingerprint {
	kept := snapshot.Fingerprint{}
	for store, tables := range fingerprint {
		if store == "redis" {
			continue
		}
		kept[store] = map[string]snapshot.TableFingerprint{}
		for table, each := range tables {
			switch {
			case strings.Contains(table, "upgrade_ledger"):
			case strings.HasSuffix(table, "_prisma_migrations"): // keyed by a random id: the count only
				kept[store][table] = snapshot.TableFingerprint{Count: each.Count}
			default:
				kept[store][table] = each
			}
		}
	}
	return kept
}

// compareUpgraded lists the data and ledger-status differences between two finished upgrades.
func compareUpgraded(a, b upgraded) []string {
	diffs := a.fingerprint.Diff(b.fingerprint)
	for id, status := range a.steps {
		if b.steps[id] != status {
			diffs = append(diffs, fmt.Sprintf("step %s: %s vs %q", id, status, b.steps[id]))
		}
	}
	for id, status := range b.steps {
		if _, ok := a.steps[id]; !ok {
			diffs = append(diffs, fmt.Sprintf("step %s: missing vs %s", id, status))
		}
	}
	return diffs
}

// logLines answers the "msg" of each line of a drill log containing needle.
func (cell *run) logLines(name, needle string) []string {
	raw, _ := os.ReadFile(cell.logPath(name)) // #nosec G304 -- the drill's own log.
	var found []string
	for _, line := range strings.Split(string(raw), "\n") {
		if needle != "" && strings.Contains(line, needle) {
			found = append(found, logMessage(line))
		}
	}
	return found
}

var messageField = regexp.MustCompile(`"msg":"((?:[^"\\]|\\.)*)"`)

func logMessage(line string) string {
	if match := messageField.FindStringSubmatch(line); match != nil {
		return match[1]
	}
	return line
}

func passText(pass bool) string {
	if pass {
		return "pass"
	}
	return "fail"
}

// twoRunnersDrill (UD-6): two upgraders start together; one applies, the other names the holder and finds nothing to do.
func (cell *run) twoRunnersDrill(ctx context.Context) (Verdict, error) {
	if err := cell.restoreFresh(ctx); err != nil {
		return Verdict{}, err
	}
	codes := make([]int, 2)
	var group sync.WaitGroup
	for index := range codes {
		group.Add(1)
		go func() {
			defer group.Done()
			codes[index], _ = cell.upgradeTask(ctx, fmt.Sprintf("ud6-runner-%d", index+1), nil)
		}()
	}
	group.Wait()
	var summary []string
	applied, waited := 0, 0
	for index := range codes {
		name := fmt.Sprintf("ud6-runner-%d", index+1)
		holder := cell.logLines(name, "held by")
		applies := cell.logLines(name, "phase postgres-schema succeeded")
		finals := cell.logLines(name, "upgrade finished")
		if len(applies) > 0 {
			applied++
		}
		if len(holder) > 0 {
			waited++
		}
		summary = append(summary, fmt.Sprintf("runner %d exit %d, applied %t, holder lines %v, finished %v", index+1, codes[index], len(applies) > 0, first(holder), first(finals)))
	}
	rows, err := Ledger(ctx, cell.stores)
	if err != nil {
		return Verdict{}, err
	}
	return Verdict{ID: "UD-6", Name: "two upgraders: one applies, the other names the holder then finds nothing to do",
		Result: passText(codes[0] == 0 && codes[1] == 0 && applied == 1 && waited == 1 && len(blockingLeft(rows)) == 0),
		Detail: strings.Join(summary, "; ") + fmt.Sprintf("; blocking steps left: %d", len(blockingLeft(rows)))}, nil
}

func first(values []string) []string {
	if len(values) > 1 {
		return values[:1]
	}
	return values
}

// alterTable finds the first table an ALTER TABLE names in a migration.
var alterTable = regexp.MustCompile(`(?i)ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?"([^"]+)"`)

// nextPrismaTable answers the first pending Prisma folder and the table its first ALTER names.
func (cell *run) nextPrismaTable(ctx context.Context) (string, string, error) {
	appliedRows, err := psql(ctx, cell.stores.psqlURL(), `SELECT migration_name FROM mydb."_prisma_migrations" WHERE finished_at IS NOT NULL`)
	if err != nil {
		return "", "", err
	}
	applied := map[string]bool{}
	for _, name := range strings.Split(appliedRows, "\n") {
		applied[strings.TrimSpace(name)] = true
	}
	dir := filepath.Join(cell.options.HeadDir, "packages", "prisma-client", "prisma", "migrations")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", "", err
	}
	for _, entry := range entries {
		if !entry.IsDir() || applied[entry.Name()] {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, entry.Name(), "migration.sql")) // #nosec G304 -- head's own migrations.
		if err != nil {
			continue
		}
		if match := alterTable.FindStringSubmatch(string(raw)); match != nil {
			return entry.Name(), match[1], nil
		}
	}
	return "", "", errors.New("no pending Prisma folder alters a table")
}

// heldLockDrill (UD-2): a session holds ACCESS EXCLUSIVE on the table; the upgrade fails by name, then converges.
func (cell *run) heldLockDrill(ctx context.Context, table string, holdFor time.Duration) (Verdict, error) {
	if err := cell.restoreFresh(ctx); err != nil {
		return Verdict{}, err
	}
	folder := "(given)"
	if table == "" {
		var err error
		if folder, table, err = cell.nextPrismaTable(ctx); err != nil {
			return Verdict{}, err
		}
	}
	holdCtx, release := context.WithCancel(ctx)
	defer release()
	statement := fmt.Sprintf(`BEGIN; LOCK TABLE mydb.%q IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(%d); COMMIT;`, strings.ReplaceAll(table, `"`, ""), int(holdFor.Seconds()))
	held := make(chan error, 1)
	go func() { _, err := psql(holdCtx, cell.stores.psqlURL(), statement); held <- err }()
	granted := `SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = '` + strings.ReplaceAll(table, "'", "") + `' AND l.mode = 'AccessExclusiveLock' AND l.granted`
	if err := waitFor(ctx, 20*time.Second, func() bool { count, _ := psql(ctx, cell.stores.psqlURL(), granted); return count != "" && count != "0" }); err != nil {
		return Verdict{}, fmt.Errorf("the lock on %q was never granted: %w", table, err)
	}
	started := time.Now()
	heldCode, _ := cell.upgradeTask(ctx, "ud2-held", nil)
	heldMs := time.Since(started).Milliseconds()
	stillHeld, _ := psql(ctx, cell.stores.psqlURL(), granted)
	release()
	holdErr := <-held
	if holdErr != nil && !errors.Is(holdCtx.Err(), context.Canceled) {
		return Verdict{}, fmt.Errorf("the lock holder ended on its own: %w", holdErr)
	}
	named := append(cell.logLines("ud2-held", "rerunnable_migration_failed"), cell.logLines("ud2-held", "failed_prisma_migration")...)
	rerunCode, _ := cell.upgradeTask(ctx, "ud2-rerun", nil)
	rows, err := Ledger(ctx, cell.stores)
	if err != nil {
		return Verdict{}, err
	}
	return Verdict{ID: "UD-2", Name: "a held lock fails by name; after release a re-run converges",
		Result: passText(heldCode != 0 && len(named) > 0 && rerunCode == 0 && len(blockingLeft(rows)) == 0),
		Detail: fmt.Sprintf("held %s on %q (folder %s) for %s, still granted when the upgrade ended: %s; upgrade exit %d after %d ms naming %v; re-run exit %d, blocking steps left %d",
			"ACCESS EXCLUSIVE", table, folder, holdFor, stillHeld, heldCode, heldMs, first(named), rerunCode, len(blockingLeft(rows)))}, nil
}

// blockingLeft is every blocking step the task leaves undone; background steps belong to the worker.
func blockingLeft(rows []LedgerRow) []LedgerRow {
	var left []LedgerRow
	rowsRange := Outstanding(rows)
	for i := range rowsRange {
		row := &rowsRange[i]
		if row.Mode == "blocking" {
			left = append(left, *row)
		}
	}
	return left
}

// firstInstallProbes are the routes UD-12 asks while the first install has failed: health stays open, the rest show the console.
var firstInstallProbes = []string{"/healthz", "/readyz", "/", "/auth/signin", "/settings", "/api/simulation-runs", "/api/trpc/organization.getAll", "/api/otel/v1/traces"}

// consoleMarker is a line of the token console's page.
const consoleMarker = "console token"

// probeRoutes answers each route's status and whether the console stood in front of it.
func (cell *run) probeRoutes(ctx context.Context) []string {
	var seen []string
	for _, path := range firstInstallProbes {
		status, body, err := get(ctx, httpClient, cell.headURL()+path)
		seen = append(seen, fmt.Sprintf("%s %d console=%t%s", path, status, strings.Contains(body, consoleMarker), errSuffix(errText(err))))
	}
	return seen
}

// firstInstallFailDrill (UD-12): a type the first Prisma folder creates already exists, so the first install
// fails; the console must front every route but health. Dropping the type and restarting the worker must serve.
func (cell *run) firstInstallFailDrill(ctx context.Context) (Verdict, error) {
	inject := `CREATE SCHEMA IF NOT EXISTS mydb; CREATE TYPE mydb."TeamUserRole" AS ENUM ('UPGRADELAB_DRILL');`
	if _, err := psql(ctx, cell.stores.psqlURL(), inject); err != nil {
		return Verdict{}, err
	}
	if err := cell.startHeadAPI(); err != nil {
		return Verdict{}, err
	}
	if err := cell.startHeadWorker(); err != nil {
		return Verdict{}, err
	}
	var failed []string
	_ = waitFor(ctx, cell.options.ReadyWithin, func() bool {
		_, body, _ := get(ctx, httpClient, cell.headURL()+"/")
		return strings.Contains(body, consoleMarker)
	})
	failed = cell.probeRoutes(ctx)
	if cell.options.Shots {
		cell.shoot(ctx, "first-install-failed")
	}
	if _, err := psql(ctx, cell.stores.psqlURL(), `DROP TYPE mydb."TeamUserRole"`); err != nil {
		return Verdict{}, err
	}
	how := "on its own"
	ready := waitFor(ctx, 2*time.Minute, func() bool {
		status, _, err := get(ctx, httpClient, cell.headURL()+"/readyz")
		return err == nil && status == 200
	}) == nil
	if !ready {
		how = "after a worker restart"
		worker := cell.proc("head-worker")
		worker.Stop(20 * time.Second)
		_ = os.Rename(cell.logPath("head-worker"), cell.logPath("head-worker-first"))
		if err := cell.startHeadWorker(); err != nil {
			return Verdict{}, err
		}
		ready = waitFor(ctx, cell.options.ReadyWithin, func() bool {
			status, _, err := get(ctx, httpClient, cell.headURL()+"/readyz")
			return err == nil && status == 200
		}) == nil
	}
	after := cell.probeRoutes(ctx)
	if cell.options.Shots {
		cell.shoot(ctx, "first-install-fixed")
	}
	fronted := consoleFrontsAllButHealth(failed)
	return Verdict{ID: "UD-12", Name: "a failed first install shows the token console in front of every route but health; fixed, it serves",
		Result: passText(fronted && ready && !strings.Contains(strings.Join(after, " "), "console=true")),
		Detail: fmt.Sprintf("while failed: %v; ready %t %s; after: %v", failed, ready, how, after)}, nil
}

// consoleFrontsAllButHealth: health answers without the console (/readyz its plain not-ready 503), every other probe shows it.
func consoleFrontsAllButHealth(probes []string) bool {
	if len(probes) == 0 {
		return false
	}
	for _, probe := range probes {
		health := strings.HasPrefix(probe, "/healthz ") || strings.HasPrefix(probe, "/readyz ")
		if health == strings.Contains(probe, "console=true") {
			return false
		}
		if strings.HasPrefix(probe, "/readyz ") && !strings.HasPrefix(probe, "/readyz 503 ") {
			return false
		}
	}
	return true
}

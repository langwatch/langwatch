package cell

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// OverlayOperatorDamage plants on main what an operator could leave behind (trial T9, ledger UM-24): a
// `_prisma_migrations` row an interrupted `prisma migrate deploy` left failed, and a hand-built index under the
// name a head migration creates, on another column. Each must stop head's upgrade by name; the cell does the fix
// the refusal names, as the operator, and the rerun must converge.
const OverlayOperatorDamage = "operator-damage"

const (
	// damageFolder is a main folder below head's re-runnable marker, so head may not re-run it unasked.
	damageFolder = "20260928120003_trigger_sent_history_index"
	damageIndex  = "AuditLog_idempotencyKey_key"
	// damageWantIndex is the definition head's 20261006170500_audit_log_idempotency_key builds.
	damageWantIndex = `CREATE UNIQUE INDEX "AuditLog_idempotencyKey_key" ON mydb."AuditLog" USING btree ("idempotencyKey")`
	damageLogs      = "Database error code: 57014\n\nDatabase error:\nERROR: canceling statement due to statement timeout\n\n" +
		"DbError { severity: \"ERROR\", code: SqlState(E57014), message: \"canceling statement due to statement timeout\" }"
	damageKindRow   = "failed-row"
	damageKindIndex = "index"
)

// damagePlantSQL leaves the folder's row as Prisma does when the deploy dies after the SQL ran, and pre-builds the index wrong.
var damagePlantSQL = `UPDATE mydb."_prisma_migrations" SET "finished_at" = NULL, "applied_steps_count" = 0, "logs" = '` +
	strings.ReplaceAll(damageLogs, "'", "''") + `' WHERE "migration_name" = '` + damageFolder + `' AND "finished_at" IS NOT NULL;
CREATE INDEX "` + damageIndex + `" ON mydb."AuditLog" ("createdAt");`

// damageRefusal is one refusal head's upgrade left in the ledger and what the operator did about it.
type damageRefusal struct {
	Kind, Step, Text   string
	AtMs               int64
	ReadyzWhile        int  // head's /readyz while refused
	SwitchedWhile      bool // the balancer had moved to head while refused
	PrismaRowsWhile    int  // _prisma_migrations rows while refused
	IndexWhile         string
	StatusOut, Shot    string
	ShotState, Fix     string
	FixErr             string
	RerunHow           string // "on its own" or "after a worker restart"
	ConvergedAfterFix  bool
	FinishedRowsBefore int // finished _prisma_migrations rows right after the plant
	FinishedRowsWhile  int
}

type damageState struct {
	plantedRows, finishedRows int
	plantedIndex              string
	refusals                  []damageRefusal
	other                     []string // failed steps the overlay did not plant
	finalIndex, finalFolder   string
	err                       error
}

// plantDamage writes the two kinds of damage into main's Postgres by SQL, as an operator could.
func (cell *run) plantDamage(ctx context.Context) error {
	dmg := &cell.damage
	if _, dmg.err = psql(ctx, cell.stores.psqlURL(), damagePlantSQL); dmg.err != nil {
		return dmg.err
	}
	failed, err := psql(ctx, cell.stores.psqlURL(), `SELECT count(*) FROM mydb."_prisma_migrations" WHERE "migration_name" = '`+damageFolder+`' AND "finished_at" IS NULL AND "rolled_back_at" IS NULL`)
	if err != nil || strings.TrimSpace(failed) != "1" {
		dmg.err = fmt.Errorf("the failed row did not take: %q: %w", failed, err)
		return dmg.err
	}
	dmg.plantedRows, dmg.finishedRows = cell.prismaRowCounts(ctx)
	dmg.plantedIndex = cell.indexDef(ctx)
	cell.report.Notes = append(cell.report.Notes, fmt.Sprintf("operator damage: %s marked failed (finished_at NULL, logs a statement timeout); %s pre-built as %s; %d _prisma_migrations rows, %d finished",
		damageFolder, damageIndex, dmg.plantedIndex, dmg.plantedRows, dmg.finishedRows))
	return nil
}

func (cell *run) prismaRowCounts(ctx context.Context) (int, int) {
	out, _ := psql(ctx, cell.stores.psqlURL(), `SELECT count(*) || ' ' || count("finished_at") FROM mydb."_prisma_migrations"`)
	var all, finished int
	_, _ = fmt.Sscanf(strings.TrimSpace(out), "%d %d", &all, &finished)
	return all, finished
}

func (cell *run) indexDef(ctx context.Context) string {
	out, _ := psql(ctx, cell.stores.psqlURL(), `SELECT coalesce(max(indexdef), '(none)') FROM pg_indexes WHERE schemaname = 'mydb' AND indexname = '`+damageIndex+`'`)
	return strings.TrimSpace(out)
}

// damageKind names which planted damage a refusal is about, by what its text names.
func damageKind(text string) string {
	switch {
	case strings.Contains(text, damageFolder):
		return damageKindRow
	case strings.Contains(text, damageIndex):
		return damageKindIndex
	}
	return ""
}

// watchDamage runs inside the wait for head: on a refusal it records what the operator sees, does the fix the
// refusal names and gets the upgrade going again. Each kind is handled once.
func (cell *run) watchDamage(ctx context.Context) {
	if !cell.overlay(OverlayOperatorDamage) || cell.damage.err != nil {
		return
	}
	out, err := psql(ctx, cell.stores.psqlURL(), `SELECT id || chr(9) || replace(coalesce(last_error, ''), chr(10), ' ') FROM mydb_upgrade_ledger._langwatch_upgrade_step WHERE status = 'failed' ORDER BY id`)
	if err != nil || strings.TrimSpace(out) == "" {
		return
	}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		step, text, _ := strings.Cut(line, "\t")
		if seen, fresh := cell.damage.classify(step, text); fresh {
			cell.handleRefusal(ctx, seen)
		}
	}
}

// classify answers a refusal the overlay planted and has not handled yet; other failed steps are kept apart.
func (dmg *damageState) classify(step, text string) (damageRefusal, bool) {
	kind := damageKind(text)
	if kind == "" {
		if !slices.Contains(dmg.other, step) {
			dmg.other = append(dmg.other, step)
		}
		return damageRefusal{}, false
	}
	if _, handled := dmg.refusal(kind); handled {
		return damageRefusal{}, false
	}
	return damageRefusal{Kind: kind, Step: step, Text: text, FinishedRowsBefore: dmg.finishedRows}, true
}

func (dmg *damageState) refusal(kind string) (*damageRefusal, bool) {
	for index := range dmg.refusals {
		if dmg.refusals[index].Kind == kind {
			return &dmg.refusals[index], true
		}
	}
	return nil, false
}

func (cell *run) handleRefusal(ctx context.Context, seen damageRefusal) {
	kind, step := seen.Kind, seen.Step
	seen.AtMs = time.Since(cell.origin).Milliseconds()
	cell.mark("refused-" + kind)
	_ = sleep(ctx, 5*time.Second) // a serving api that slipped through would show by now
	seen.ReadyzWhile, _, _ = get(ctx, httpClient, cell.headURL()+"/readyz")
	seen.SwitchedWhile = cell.marks["switched"] != 0
	seen.PrismaRowsWhile, seen.FinishedRowsWhile = cell.prismaRowCounts(ctx)
	seen.IndexWhile = cell.indexDef(ctx)
	seen.StatusOut = cell.headTask(ctx, "upgrade-status-"+kind, "upgrade", "status")
	if cell.options.Shots {
		// The console holds every door but health while refused, so no one signs in to Ops > Upgrades on head.
		page, file := cell.shootPage(ctx, "refused-console-"+kind, nil)
		seen.Shot, seen.ShotState = file, firstLine(page)
	}
	seen.Fix, seen.FixErr = cell.fixDamage(ctx, kind)
	cleared := func() bool {
		left, _ := psql(ctx, cell.stores.psqlURL(), `SELECT count(*) FROM mydb_upgrade_ledger._langwatch_upgrade_step WHERE status = 'failed' AND id = '`+step+`'`)
		return strings.TrimSpace(left) == "0"
	}
	seen.RerunHow = "on its own"
	if waitFor(ctx, 2*time.Minute, cleared) != nil {
		seen.RerunHow = "after a worker restart"
		worker := cell.proc("head-worker")
		worker.Stop(20 * time.Second)
		cell.procsMu.Lock()
		cell.procs = slices.DeleteFunc(cell.procs, func(proc *Proc) bool { return proc == worker })
		cell.procsMu.Unlock()
		_ = os.Rename(cell.logPath("head-worker"), cell.logPath("head-worker-refused-"+kind))
		if err := cell.startHeadWorker(); err != nil {
			seen.FixErr += " restart: " + err.Error()
		}
	}
	cell.damage.refusals = append(cell.damage.refusals, seen)
}

// fixDamage does what the refusal tells an operator: the folder's SQL had run, so it is recorded applied; the
// wrong index is the operator's own, so it is dropped for the migration to build.
func (cell *run) fixDamage(ctx context.Context, kind string) (string, string) {
	if kind == damageKindIndex {
		statement := `DROP INDEX mydb."` + damageIndex + `"`
		_, err := psql(ctx, cell.stores.psqlURL(), statement)
		return statement, errText(err)
	}
	fix := "prisma migrate resolve --applied " + damageFolder
	config, err := cell.operatorPrismaConfig()
	if err != nil {
		return fix, err.Error()
	}
	client := filepath.Join(cell.options.HeadDir, "packages", "prisma-client")
	command := exec.CommandContext(ctx, "node", filepath.Join(client, "node_modules", "prisma", "build", "index.js"), "migrate", "resolve", "--applied", damageFolder, "--config", config) // #nosec G204 -- fixed argv.
	command.Dir, command.Env = filepath.Dir(config), append(cell.envWith(nil), "CHECKPOINT_DISABLE=1")
	out, err := command.CombinedOutput()
	_ = os.WriteFile(cell.logPath("operator-fix-"+kind), out, 0o600)
	if err != nil {
		return fix, err.Error() + ": " + tail(out)
	}
	return fix, ""
}

// refusalLine is an error line the planted damage causes on purpose: the refusal and the api holding the door, before ready.
func refusalLine(line string, ready int64, origin time.Time) bool {
	if !strings.Contains(line, "failed_prisma_migration") && !strings.Contains(line, "holds the door with the upgrade console") {
		return false
	}
	epoch, ok := lineEpochMs(line)
	return ok && (ready < 0 || epoch-origin.UnixMilli() <= ready)
}

// operatorPrismaConfig writes the config an operator needs: the image's prisma.config.ts names no datasource
// url, so `prisma migrate resolve` refuses with it (T9-F1). It reads DATABASE_URL, as the runner's own does.
func (cell *run) operatorPrismaConfig() (string, error) {
	dir := filepath.Join(cell.options.RunDir, "operator-prisma")
	migrations := filepath.Join(cell.options.HeadDir, "packages", "prisma-client", "prisma", "migrations")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	schema, config := filepath.Join(dir, "schema.prisma"), filepath.Join(dir, "prisma.config.mjs")
	if err := os.WriteFile(schema, []byte("datasource db {\n  provider = \"postgresql\"\n}\n"), 0o600); err != nil {
		return "", err
	}
	body := fmt.Sprintf("export default { schema: %q, migrations: { path: %q }, datasource: { url: process.env.DATABASE_URL } };\n", schema, migrations)
	return config, os.WriteFile(config, []byte(body), 0o600)
}

// headTask runs one of head's tasks once into its own log and answers the output.
func (cell *run) headTask(ctx context.Context, logName string, args ...string) string {
	taskCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	command := exec.CommandContext(taskCtx, "node", append([]string{"--experimental-transform-types", "src/main.ts"}, args...)...) // #nosec G204 -- fixed argv.
	command.Dir, command.Env = filepath.Join(cell.options.HeadDir, "apps", "tasks"), cell.envWith(nil)
	out, err := command.CombinedOutput()
	_ = os.WriteFile(cell.logPath(logName), out, 0o600)
	if err != nil {
		return fmt.Sprintf("(%v) %s", err, out)
	}
	return string(out)
}

func firstLine(page string) string {
	_, text, _ := strings.Cut(page, "\n")
	line, _, _ := strings.Cut(strings.TrimSpace(text), "\n")
	return line
}

// damageVerdicts reads the end state and judges D1 to D3.
func (cell *run) damageVerdicts(ctx context.Context) []Verdict {
	if !cell.overlay(OverlayOperatorDamage) {
		return nil
	}
	if cell.damage.err != nil {
		return []Verdict{{ID: "D1", Name: "operator damage planted", Result: "fail", Detail: cell.damage.err.Error()}}
	}
	cell.damage.finalIndex = cell.indexDef(ctx)
	cell.damage.finalFolder, _ = psql(ctx, cell.stores.psqlURL(), `SELECT count(*) FILTER (WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) || ' applied, ' || count(*) FILTER (WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL) || ' failed' FROM mydb."_prisma_migrations" WHERE "migration_name" = '`+damageFolder+`'`)
	return judgeDamage(cell.damage, cell.poller != nil && FirstAt(cell.poller.Timeline(), "ready") >= 0)
}

// judgeDamage: D1 the failed row, D2 the index, D3 what the operator sees while refused.
func judgeDamage(dmg damageState, ready bool) []Verdict {
	folderOK := strings.TrimSpace(dmg.finalFolder) == "1 applied, 0 failed"
	return []Verdict{
		judgeRefusal(&dmg, refusalCase{"D1", "a failed _prisma_migrations row stops the upgrade by name with its fix, nothing else is touched, and the fixed rerun converges",
			damageKindRow, "prisma migrate resolve", folderOK, "folder " + strings.TrimSpace(dmg.finalFolder)}, ready),
		judgeRefusal(&dmg, refusalCase{"D2", "a hand-built index under a migration's name on other columns stops the upgrade by name with its fix, and the fixed rerun builds the migration's index",
			damageKindIndex, damageIndex, dmg.finalIndex == damageWantIndex, "index " + dmg.finalIndex}, ready),
		judgeWhileRefused(&dmg),
	}
}

type refusalCase struct {
	id, name, kind, fixWord string
	endOK                   bool
	end                     string
}

func judgeRefusal(dmg *damageState, c refusalCase, ready bool) Verdict {
	r, refused := dmg.refusal(c.kind)
	if !refused {
		return Verdict{ID: c.id, Name: c.name, Result: "fail", Detail: fmt.Sprintf("never refused; ready %t; at the end: %s; other failed steps: %v", ready, c.end, dmg.other)}
	}
	names := strings.Contains(r.Text, c.fixWord)
	held := r.ReadyzWhile != 200 && !r.SwitchedWhile
	kept := r.PrismaRowsWhile >= dmg.plantedRows && (c.kind == damageKindIndex || r.FinishedRowsWhile == r.FinishedRowsBefore)
	pass := names && held && kept && r.FixErr == "" && ready && c.endOK
	return Verdict{ID: c.id, Name: c.name, Result: passText(pass), Detail: fmt.Sprintf(
		"refused on %s at %d ms: %q; names the fix (%s): %t; while refused /readyz %d, switched %t, prisma rows %d (planted %d), finished %d (before %d); operator fix %q %s; rerun %s; ready %t; at the end: %s",
		r.Step, r.AtMs, r.Text, c.fixWord, names, r.ReadyzWhile, r.SwitchedWhile, r.PrismaRowsWhile, dmg.plantedRows, r.FinishedRowsWhile, r.FinishedRowsBefore, r.Fix, r.FixErr, r.RerunHow, ready, c.end)}
}

func judgeWhileRefused(dmg *damageState) Verdict {
	var seen []string
	pass := len(dmg.refusals) > 0
	for index := range dmg.refusals {
		r := &dmg.refusals[index]
		statusNames := strings.Contains(r.StatusOut, r.Step) || strings.Contains(r.StatusOut, damageFolder) || strings.Contains(r.StatusOut, damageIndex)
		pass = pass && statusNames && r.ReadyzWhile != 200
		seen = append(seen, fmt.Sprintf("%s: upgrade status names it %t, head's page %s reads %q, /readyz %d", r.Kind, statusNames, r.Shot, r.ShotState, r.ReadyzWhile))
	}
	return Verdict{ID: "D3", Name: "while refused, `pnpm task upgrade status` names the failure and the api stays not ready", Result: passText(pass), Detail: strings.Join(seen, "; ")}
}

package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/procsupervisor"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/prunetui"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// sharedResourcesNote names the machine-wide servers prune never removes — it
// only ever drops a worktree's own database on each. Shown in both the picker
// footer and the agent report so the shared/non-shared split is always explicit.
const sharedResourcesNote = "shared ClickHouse · Postgres · Redis · observability are machine-wide and never removed"

// runClean is `haven clean` — the one cleanup command. In a terminal it opens
// the interactive picker (concurrent scan: disk size, databases, idle time;
// stale ones pre-ticked; removes exactly what the user confirms, with the
// primary-checkout / running-from guards and database-drop safety of
// DestroyWorktree), then reclaims the safe categories — regenerable build
// artifacts of idle worktrees and orphaned dev processes — as part of the same
// run. `--yes` skips the picker and applies ONLY the safe categories. Agents
// (and any non-TTY) get the read-only report and delete nothing without `--yes`.
//
// "Safe categories" is literal: what is reclaimed unattended is regenerable.
// Build artifacts and orphaned dev processes have always been. Two more join
// them, and they qualify for the same reason:
//   - temporary and merged worktrees. A temporary one is scratch a diff tool or
//     an agent made on demand and will make again; a merged one's commits are
//     already on origin/main. Neither is ever dirty, live, the primary checkout,
//     or the worktree haven runs from — the classification refuses all four.
//   - finished (or week-cold) agent job scratch. The two record files —
//     state.json and timeline.jsonl — are kept; what goes is the working files
//     the run produced, which re-running the job produces again.
//
// It still excludes each worktree's ClickHouse and Postgres databases, which are
// NOT regenerable — only the interactive picker, which shows the user exactly
// which databases are in scope, may drop those. Data loss is always explicit
// (ADR-064), and `--yes` is by definition unattended.
func runClean(ctx context.Context, d deps, inv invocation) error {
	if inv.has("--yes") {
		if err := d.orch.Prune(ctx, d.worktree, app.PruneOptions{
			ShouldAct: true,
			// Never on this path — see the note above.
			ShouldReclaimDatabases: false,
		}); err != nil {
			return err
		}
		reclaimClassifiedWorktrees(ctx, d)
		reclaimJobScratch(d)
		reapOrphanRuntimes(d)
		reapOrphanPlays(ctx, d)
		return nil
	}
	threshold := pruneStaleThreshold(inv)
	if d.isAgent {
		rows, err := d.orch.PlanPrune(d.worktree, d.worktree)
		if err != nil {
			return err
		}
		return printPruneReport(ctx, d, rows, threshold)
	}
	return runInteractiveClean(ctx, d, threshold)
}

// runInteractiveClean is the terminal cleanup flow — the picker plus the
// always-safe orphan reaping — shared by `haven clean` and the hub's "c"
// handoff.
func runInteractiveClean(ctx context.Context, d deps, threshold time.Duration) error {
	rows, err := d.orch.PlanPrune(d.worktree, d.worktree)
	if err != nil {
		return err
	}
	jobs, jerr := d.orch.PlanJobs()
	if jerr != nil {
		// A jobs root that cannot be read is worth saying once and no more: the
		// worktree half of the cleanup is the reason the command was run.
		fmt.Printf("agent job scratch skipped (%v)\n", jerr)
	}
	if err := prunetui.Run(ctx, d.pruneActions(rows, reclaimableJobs(jobs), threshold)); err != nil {
		return err
	}
	reapOrphanRuntimes(d)
	reapOrphanPlays(ctx, d)
	return nil
}

// reclaimClassifiedWorktrees removes the temporary and merged worktrees on the
// unattended path. Both classes are regenerable by definition (see runClean),
// and every guard lives in the classification, so this only reports what it did.
func reclaimClassifiedWorktrees(ctx context.Context, d deps) {
	d.orch.ReclaimClassifiedWorktrees(ctx, d.worktree, func(c app.ReclaimableWorktree, err error) {
		if err != nil {
			fmt.Printf("  kept    %-38s (%v)\n", filepath.Base(c.Dir), err)
			return
		}
		fmt.Printf("  removed %-38s %s (%s)\n", filepath.Base(c.Dir), c.Class, c.Reason)
	})
}

// reclaimJobScratch deletes the scratch of every reclaimable agent job, keeping
// each job's two record files.
func reclaimJobScratch(d deps) {
	jobs, err := d.orch.PlanJobs()
	if err != nil {
		fmt.Printf("agent job scratch skipped (%v)\n", err)
		return
	}
	reclaimable := reclaimableJobs(jobs)
	if len(reclaimable) == 0 {
		return
	}
	var dirs []string
	for _, j := range reclaimable {
		dirs = append(dirs, j.Dir)
	}
	var total int64
	d.orch.ReclaimJobs(dirs, func(dir string, freed int64, rerr error) {
		if rerr != nil {
			fmt.Printf("  kept  %-40s (%v)\n", filepath.Base(dir), rerr)
			return
		}
		total += freed
	})
	fmt.Printf("reclaimed %s of agent job scratch from %d job(s) (records kept)\n", domain.HumanBytes(total), len(dirs))
}

// reclaimableJobs is the subset a cleanup ever offers or acts on.
func reclaimableJobs(jobs []app.JobRow) []app.JobRow {
	var out []app.JobRow
	for _, j := range jobs {
		if j.Reclaimable {
			out = append(out, j)
		}
	}
	return out
}

// reapOrphanPlays finishes the teardown of play sandboxes whose owning process
// died hard - safe by contract: a play sandbox's data is ephemeral, disclosed
// as destroyed-on-exit before it was ever created.
func reapOrphanPlays(ctx context.Context, d deps) {
	n, err := d.orch.ReapOrphanPlays(ctx)
	if err != nil {
		fmt.Printf("play sandbox reaping hit errors (re-run haven clean): %v\n", err)
	}
	if n > 0 {
		fmt.Printf("reaped %d orphaned play sandbox(es)\n", n)
	}
}

// reapOrphanRuntimes is the always-safe tail of a clean: kill dev runtimes
// (tsgo, node, pnpm, uv, python) that have been orphaned to pid 1 but
// still reference this worktree.
func reapOrphanRuntimes(d deps) {
	procsupervisor.ReapOrphans([]string{d.worktree})
	fmt.Println("reaped orphaned dev runtimes")
}

// pruneStaleThreshold resolves the idle age at which a worktree is pre-selected:
// the built-in default (5 days), overridable by HAVEN_PRUNE_STALE_DAYS and then
// by an explicit --stale-days N.
func pruneStaleThreshold(inv invocation) time.Duration {
	days := int(app.DefaultStaleThreshold / (24 * time.Hour))
	if v := os.Getenv("HAVEN_PRUNE_STALE_DAYS"); v != "" {
		if n, ok := parseNonNegInt(v); ok {
			days = n
		}
	}
	if v := inv.value("--stale-days"); v != "" {
		if n, ok := parseNonNegInt(v); ok {
			days = n
		}
	}
	return time.Duration(days) * 24 * time.Hour
}

func parseNonNegInt(s string) (int, bool) {
	// Atoi (not Sscanf) so trailing garbage like "5abc" is rejected rather than
	// silently read as 5 — a stale-days value must be a whole number or nothing.
	if n, err := strconv.Atoi(s); err == nil && n >= 0 {
		return n, true
	}
	return 0, false
}

// pruneActions adapts the orchestrator to the picker's callback surface. Delete
// is pinned to this repo and this launch directory, so the primary checkout and
// the worktree haven runs from are refused in the app layer no matter what the
// picker asks for — the same wiring the hub uses. Reclaimable agent jobs are
// appended to the same list, so one screen shows everything a cleanup can free
// and one confirmation applies to all of it; the delete callback routes each
// chosen directory back to the right teardown by its kind.
func (d deps) pruneActions(rows []app.PruneRow, jobs []app.JobRow, threshold time.Duration) prunetui.Actions {
	isJob := map[string]bool{}
	for _, j := range jobs {
		isJob[j.Dir] = true
	}
	return prunetui.Actions{
		Rows:       append(worktreePickerRows(rows), jobPickerRows(jobs)...),
		Threshold:  threshold,
		Scan:       d.pickerScan(rows, jobs),
		DeleteAll:  d.pickerDelete(isJob),
		SharedNote: sharedResourcesNote,
	}
}

// worktreePickerRows is the worktree half of the list: identity and guards now,
// footprint later.
func worktreePickerRows(rows []app.PruneRow) []prunetui.Row {
	out := make([]prunetui.Row, 0, len(rows))
	for _, r := range rows {
		out = append(out, prunetui.Row{
			Dir:       r.Dir,
			Branch:    r.Branch,
			Slug:      r.Slug,
			IsPrimary: r.IsPrimary,
			IsCurrent: r.IsCurrent,
			IsLive:    r.IsLive,
			Deletable: r.Deletable(),
		})
	}
	return out
}

// jobPickerRows is the agent-job half. A job's facts are all known the moment it
// is planned, so its row lands complete except for the size — the one thing that
// needs a du.
func jobPickerRows(jobs []app.JobRow) []prunetui.Row {
	out := make([]prunetui.Row, 0, len(jobs))
	for _, j := range jobs {
		out = append(out, prunetui.Row{
			Dir:        j.Dir,
			Branch:     jobLabel(j),
			Kind:       prunetui.KindJob,
			Deletable:  true,
			MetaKnown:  true,
			RedisDB:    -1,
			StaleFor:   j.Age,
			StaleKnown: j.Age > 0,
			Reason:     j.Reason,
		})
	}
	return out
}

// pickerScan runs both size queues under one callback surface. The job rows were
// appended after the worktree rows, so their scan indices are offset by that many.
func (d deps) pickerScan(rows []app.PruneRow, jobs []app.JobRow) func(context.Context, func(int, prunetui.MetaResult), func(int, int64)) {
	return func(ctx context.Context, onMeta func(int, prunetui.MetaResult), onSize func(int, int64)) {
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			d.orch.ScanWorktrees(ctx, rows,
				func(i int, meta app.PruneMeta) { onMeta(i, pickerMeta(meta)) },
				onSize,
			)
		}()
		go func() {
			defer wg.Done()
			d.orch.ScanJobSizes(ctx, jobs, func(i int, bytes int64) { onSize(len(rows)+i, bytes) })
		}()
		wg.Wait()
	}
}

func pickerMeta(meta app.PruneMeta) prunetui.MetaResult {
	return prunetui.MetaResult{
		HasCHDB:    meta.HasCHDB,
		HasPGDB:    meta.HasPGDB,
		RedisDB:    meta.RedisDB,
		IsDirty:    meta.IsDirty,
		OriginGone: meta.OriginGone,
		StaleFor:   meta.StaleFor,
		StaleKnown: !meta.LastActive.IsZero(),
		Reason:     meta.Reason,
	}
}

// pickerDelete routes each confirmed directory to the teardown its kind needs:
// a worktree's stack is stopped and its databases dropped, a job keeps its
// record and loses its scratch.
func (d deps) pickerDelete(isJob map[string]bool) func(context.Context, []string, func(string, error)) {
	return func(ctx context.Context, dirs []string, onDone func(dir string, err error)) {
		var worktreeDirs, jobDirs []string
		for _, dir := range dirs {
			if isJob[dir] {
				jobDirs = append(jobDirs, dir)
				continue
			}
			worktreeDirs = append(worktreeDirs, dir)
		}
		if len(jobDirs) > 0 {
			d.orch.ReclaimJobs(jobDirs, func(dir string, _ int64, err error) { onDone(dir, err) })
		}
		d.orch.DestroyWorktrees(ctx, d.worktree, worktreeDirs, d.worktree, onDone)
	}
}

// jobLabel is what the picker calls a job: its own name when it has one, else
// its id. The id is always in the path shown beside it, so a named job reads as
// what it was for rather than as eight hex characters.
func jobLabel(j app.JobRow) string {
	if j.Name != "" {
		return j.Name
	}
	return j.ID
}

// printPruneReport is the agent / non-TTY form: it runs the fast meta pass only
// (idle time, databases, dirty, origin-gone) and prints a plain table, marking
// with "*" the worktrees idle enough to be the default deletion set. It skips the
// slow per-worktree `du` sizing on purpose — an agent can't act on the picker
// anyway, and waiting on du across a large fleet would hang the command — so sizes
// are a terminal-only affordance. It deletes nothing.
func printPruneReport(ctx context.Context, d deps, rows []app.PruneRow, threshold time.Duration) error {
	metas := make([]app.PruneMeta, len(rows))
	d.orch.ScanMeta(ctx, rows, func(i int, meta app.PruneMeta) { metas[i] = meta })

	fmt.Printf("haven clean — %d worktree(s)\n\n", len(rows))
	defaults := 0
	for i, r := range rows {
		meta := metas[i]
		mark := " "
		if app.DefaultSelected(r, meta, threshold) {
			mark = "*"
			defaults++
		}
		fmt.Printf(" %s %-26s %-9s  %-6s %s\n",
			mark, truncateCell(domain.SlugOrBase(r.Slug, r.Dir), 26), reportIdle(meta), domain.DBChips(meta.HasCHDB, meta.HasPGDB), reportFlags(r, meta))
	}

	if orphans := d.orch.OrphanPlays(); len(orphans) > 0 {
		fmt.Printf("\n%d orphaned play sandbox(es) awaiting teardown:\n", len(orphans))
		for _, rec := range orphans {
			fmt.Printf("   pr-%d  %s\n", rec.Number, rec.Checkout)
		}
		fmt.Println("Run `haven clean --yes` (or `haven clean` in a terminal) to reap them.")
	}

	days := int(threshold / (24 * time.Hour))
	fmt.Printf("\n* = pre-selected: idle ≥ %dd, or classified temporary / merged — %d worktree(s).\n", days, defaults)
	printJobReport(d)
	fmt.Println(strings.ToUpper(sharedResourcesNote[:1]) + sharedResourcesNote[1:] + ".")
	fmt.Println("Run `haven clean` in a terminal to see sizes, sort, and delete; `haven clean --yes` reclaims build caches, orphan processes, temporary and merged worktrees, and finished job scratch — never a database.")
	return nil
}

// printJobReport is the agent report's agent-job section: which job directories
// hold reclaimable scratch, and how many are kept and why. Like the worktree
// table it deletes nothing and skips the per-job `du` — an agent cannot act on
// the picker, and sizing two hundred directories would hang the command.
func printJobReport(d deps) {
	jobs, err := d.orch.PlanJobs()
	if err != nil {
		fmt.Printf("\nagent job scratch: unreadable (%v)\n", err)
		return
	}
	if len(jobs) == 0 {
		return
	}
	reclaimable := reclaimableJobs(jobs)
	fmt.Printf("\nagent job scratch — %d job(s), %d reclaimable\n\n", len(jobs), len(reclaimable))
	for _, j := range reclaimable {
		fmt.Printf(" * %-26s %-9s %s\n", truncateCell(jobLabel(j), 26), domain.HumanAge(j.Age), j.Reason)
	}
	if kept := len(jobs) - len(reclaimable); kept > 0 {
		fmt.Printf("   %d job(s) kept (in use, or still active).\n", kept)
	}
	fmt.Printf("Reclaiming a job deletes its scratch and keeps %s.\n", strings.Join(domain.JobRecordFiles, " + "))
}

func reportIdle(meta app.PruneMeta) string {
	if meta.LastActive.IsZero() {
		return "idle ?"
	}
	return "idle " + domain.HumanAge(meta.StaleFor)
}

func reportFlags(r app.PruneRow, meta app.PruneMeta) string {
	switch {
	case r.IsPrimary:
		return "primary (protected)"
	case r.IsCurrent:
		return "current (protected)"
	}
	var flags []string
	if r.IsLive {
		flags = append(flags, "live")
	}
	if meta.IsDirty {
		flags = append(flags, "uncommitted")
	}
	if meta.OriginGone {
		flags = append(flags, "origin-gone")
	}
	if meta.Reason != "" {
		flags = append(flags, string(meta.Class)+": "+meta.Reason)
	}
	return strings.Join(flags, " · ")
}

func truncateCell(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

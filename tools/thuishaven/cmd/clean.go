package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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

// cleanLogFile is where `haven clean` writes its structured log, under the haven
// home. Every path this command takes writes there and none writes to the
// terminal: a reclaim of two hundred items emits two hundred zap records, and
// interleaving those with a spinner (or with the plain per-item lines an agent
// parses) makes both unreadable.
const cleanLogFile = "clean.log"

// confirmNoteWorktrees and confirmNoteJobs are what the confirmation screen
// spells out about each kind, in the words of what actually happens.
const (
	confirmNoteWorktrees = "each worktree's stack is stopped, its databases dropped, and its directory removed."
	confirmNoteJobs      = "each job keeps state.json + timeline.jsonl; everything else in its directory goes."
)

// cleanOutput is who owns stdout for one `haven clean` run. The command has
// exactly two output modes and they are mutually exclusive: a full-screen picker
// that owns the terminal, or plain lines — one per item — that a person or an
// agent reads top to bottom. Both send the structured log to a file, because in
// the first a log line scribbles over the interface and in the second it breaks
// the one-line-per-item contract.
type cleanOutput struct {
	// Stream is the one owner of stdout for this run.
	Stream cleanStream
	// LogFile is the file under the haven home the structured log goes to. It is
	// never empty: nothing this command does wants zap on the terminal.
	LogFile string
}

// cleanStream is who writes to stdout. One value, not two flags, so "both" and
// "neither" are not states the command can reach.
type cleanStream int

const (
	// streamPicker: a full-screen picker owns the terminal, one per kind.
	streamPicker cleanStream = iota
	// streamPerItem: one plain line per reclaimed item, and no spinner at all.
	streamPerItem
)

// decideCleanOutput resolves the output mode. `--yes` is unattended by
// definition, an agent cannot drive a TUI, and a piped stdout is not a terminal
// — all three read the same plain lines.
func decideCleanOutput(isAgent, isTTY, unattended bool) cleanOutput {
	if unattended || isAgent || !isTTY {
		return cleanOutput{Stream: streamPerItem, LogFile: cleanLogFile}
	}
	return cleanOutput{Stream: streamPicker, LogFile: cleanLogFile}
}

// runClean is `haven clean` — the one cleanup command. In a terminal it opens
// two pickers in turn, worktrees then agent job scratch, each with its own
// concurrent scan, its own pre-ticks and its own confirmation; then it reclaims
// the safe categories — regenerable build artifacts and orphaned dev processes —
// as part of the same run. `--yes` skips the pickers and applies exactly the
// pre-tick defaults. Agents (and any non-TTY) get the read-only report and
// delete nothing without `--yes`.
//
// "Safe categories" is literal: what is reclaimed unattended is regenerable.
// Build artifacts and orphaned dev processes have always been. Two more join
// them, and they qualify for the same reason:
//   - temporary and merged worktrees. A temporary one is scratch a diff tool or
//     an agent made on demand and will make again; a merged one's commits are
//     already on origin/main. Neither is ever dirty, live, the primary checkout,
//     or the worktree haven runs from — the classification refuses all four.
//   - cold agent job scratch: a job terminal for more than two days, or untouched
//     for a week. The two record files — state.json and timeline.jsonl — are
//     kept; what goes is the working files the run produced, which re-running the
//     job produces again. A job that finished this morning is NOT cold, and
//     `--include-recent` is the only thing that reaches it.
//
// It still excludes each worktree's ClickHouse and Postgres databases, which are
// NOT regenerable — only the interactive picker, which shows the user exactly
// which databases are in scope, may drop those. Data loss is always explicit
// (ADR-064), and `--yes` is by definition unattended.
func runClean(ctx context.Context, d deps, inv invocation) error {
	run := newCleanRun(d, inv)
	d.orch.RedirectLogsToFile(run.out.LogFile)

	if inv.has("--yes") {
		return run.unattended(ctx)
	}
	if run.out.Stream == streamPerItem {
		return run.report(ctx)
	}
	return runInteractiveClean(ctx, run)
}

// cleanRun is one `haven clean` invocation: the wired graph, the settings the
// flags resolved to, who owns the output, and the tally the whole run adds up
// into. It exists so each step takes the run rather than five loose arguments,
// and so no step can read a different scope from its neighbour.
type cleanRun struct {
	d         deps
	threshold time.Duration
	scope     app.JobReclaimScope
	out       cleanOutput
	tally     domain.ReclaimTally
}

// newCleanRun resolves the flags once, at the top of the command.
func newCleanRun(d deps, inv invocation) *cleanRun {
	scope := app.ColdJobsOnly
	if inv.has("--include-recent") {
		scope = app.IncludeRecentJobs
	}
	return &cleanRun{
		d:         d,
		threshold: pruneStaleThreshold(inv),
		scope:     scope,
		out:       decideCleanOutput(d.isAgent, stdoutIsTTY(), inv.has("--yes")),
	}
}

// unattended is `haven clean --yes`: no picker, no spinner, one plain line per
// item, and one summary naming each kind separately.
func (r *cleanRun) unattended(ctx context.Context) error {
	if err := r.d.orch.Prune(ctx, r.d.worktree, app.PruneOptions{
		ShouldAct: true,
		// Never on this path — see the note above.
		ShouldReclaimDatabases: false,
	}); err != nil {
		return err
	}
	r.reclaimClassifiedWorktrees(ctx)
	r.reclaimJobScratch()
	r.finish(ctx)
	return nil
}

// runInteractiveClean is the terminal cleanup flow, shared by `haven clean` and
// the hub's "c" handoff: the worktree picker, then the job-scratch picker, then
// the always-safe orphan reaping. Two pickers, never one merged list — the two
// kinds have different guards, different consequences and different ages, and a
// single list invites ticking one while reading the other.
func runInteractiveClean(ctx context.Context, r *cleanRun) error {
	if err := r.worktreePicker(ctx); err != nil {
		return err
	}
	if err := r.jobPicker(ctx); err != nil {
		return err
	}
	r.finish(ctx)
	return nil
}

// finish is the always-safe tail every cleanup path ends with, and the one line
// that says what the whole run freed.
func (r *cleanRun) finish(ctx context.Context) {
	reapOrphanRuntimes(r.d)
	reapOrphanPlays(ctx, r.d)
	fmt.Println(r.tally.Summary())
}

// worktreePicker is the first of the two pickers: worktrees only.
func (r *cleanRun) worktreePicker(ctx context.Context) error {
	d, threshold := r.d, r.threshold
	rows, err := d.orch.PlanPrune(d.worktree, d.worktree)
	if err != nil {
		return err
	}
	res, err := prunetui.Run(ctx, prunetui.Actions{
		Rows:        worktreePickerRows(rows),
		Kind:        domain.WorktreeKind,
		ConfirmNote: confirmNoteWorktrees,
		Threshold:   threshold,
		Scan: func(ctx context.Context, onMeta func(int, prunetui.MetaResult), onSize func(int, int64)) {
			d.orch.ScanWorktrees(ctx, rows,
				func(i int, meta app.PruneMeta) { onMeta(i, pickerMeta(meta)) },
				onSize,
			)
		},
		DeleteAll: func(ctx context.Context, dirs []string, onDone func(string, error)) {
			d.orch.DestroyWorktrees(ctx, d.worktree, dirs, d.worktree, onDone)
		},
		SharedNote: sharedResourcesNote,
	})
	r.record(domain.WorktreeKind, res)
	return err
}

// jobPicker is the second picker: agent job scratch only. A jobs root that
// cannot be read is worth saying once and no more — the worktree half of the
// cleanup is usually the reason the command was run.
func (r *cleanRun) jobPicker(ctx context.Context) error {
	d, scope := r.d, r.scope
	jobs, err := d.orch.PlanJobs()
	if err != nil {
		fmt.Printf("agent job scratch skipped (%v)\n", err)
		return nil
	}
	rows := jobPickerRows(jobs, scope)
	if len(rows) == 0 {
		return nil
	}
	res, rerr := prunetui.Run(ctx, prunetui.Actions{
		Rows:        rows,
		Kind:        domain.JobScratchKind,
		ConfirmNote: confirmNoteJobs,
		Scan: func(ctx context.Context, _ func(int, prunetui.MetaResult), onSize func(int, int64)) {
			d.orch.ScanJobSizes(ctx, jobs, onSize)
		},
		DeleteAll: func(_ context.Context, dirs []string, onDone func(string, error)) {
			d.orch.ReclaimJobs(dirs, scope, func(dir string, _ int64, err error) { onDone(dir, err) })
		},
		SharedNote: "a reclaim keeps " + strings.Join(domain.JobRecordFiles, " + ") + " in every job",
	})
	r.record(domain.JobScratchKind, res)
	return rerr
}

// record folds one picker's outcome into the run's tally, so the final line
// counts and sizes each kind on its own.
func (r *cleanRun) record(kind domain.ReclaimKind, res prunetui.Result) {
	r.tally.AddMany(kind, res.Reclaimed, res.Freed)
	r.tally.KeptMany(kind, res.Failed)
}

// reclaimClassifiedWorktrees removes the temporary and merged worktrees on the
// unattended path, one plain line per worktree. Both classes are regenerable by
// definition (see runClean), and every guard lives in the classification.
func (r *cleanRun) reclaimClassifiedWorktrees(ctx context.Context) {
	d := r.d
	d.orch.ReclaimClassifiedWorktrees(ctx, d.worktree, func(c app.ReclaimableWorktree, err error) {
		if err != nil {
			r.tally.Kept(domain.WorktreeKind)
			fmt.Printf("kept      worktree      %-38s %v\n", filepath.Base(c.Dir), err)
			return
		}
		r.tally.Add(domain.WorktreeKind, 0)
		fmt.Printf("reclaimed worktree      %-38s %s (%s)\n", filepath.Base(c.Dir), c.Class, c.Reason)
	})
}

// reclaimJobScratch deletes the scratch of every job in scope, keeping each
// job's two record files, one plain line per job.
func (r *cleanRun) reclaimJobScratch() {
	d, scope := r.d, r.scope
	jobs, err := d.orch.PlanJobs()
	if err != nil {
		fmt.Printf("agent job scratch skipped (%v)\n", err)
		return
	}
	inScope := jobsInScope(jobs, scope)
	if len(inScope) == 0 {
		return
	}
	reasons := map[string]string{}
	dirs := make([]string, 0, len(inScope))
	for _, j := range inScope {
		dirs = append(dirs, j.Dir)
		reasons[j.Dir] = j.Reason
	}
	d.orch.ReclaimJobs(dirs, scope, func(dir string, freed int64, rerr error) {
		if rerr != nil {
			r.tally.Kept(domain.JobScratchKind)
			fmt.Printf("kept      job scratch   %-38s %v\n", filepath.Base(dir), rerr)
			return
		}
		r.tally.Add(domain.JobScratchKind, freed)
		fmt.Printf("reclaimed job scratch   %-38s %8s (%s)\n", filepath.Base(dir), domain.HumanBytes(freed), reasons[dir])
	})
}

// jobsInScope is the subset a cleanup may act on at this scope: reclaimable, and
// cold unless the operator asked for the recent ones by name.
func jobsInScope(jobs []app.JobRow, scope app.JobReclaimScope) []app.JobRow {
	var out []app.JobRow
	for _, j := range jobs {
		if app.InScope(j.JobVerdict, scope) {
			out = append(out, j)
		}
	}
	return out
}

// reclaimableJobs is every job whose scratch a cleanup would ever consider —
// including the recent ones, which the picker shows held back rather than hiding.
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

// worktreePickerRows is the worktree picker's list: identity and guards now,
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

// jobPickerRows is the job picker's list. A job's facts are all known the moment
// it is planned, so its row lands complete except for the size — the one thing
// that needs a du — and carries its own pre-tick: only a cold job is ticked, and
// only a job in scope can be ticked at all.
func jobPickerRows(jobs []app.JobRow, scope app.JobReclaimScope) []prunetui.Row {
	offered := reclaimableJobs(jobs)
	out := make([]prunetui.Row, 0, len(offered))
	for _, j := range offered {
		out = append(out, prunetui.Row{
			Dir:        j.Dir,
			Branch:     jobLabel(j),
			Kind:       prunetui.KindJob,
			Deletable:  app.InScope(j.JobVerdict, scope),
			Preselect:  j.Cold,
			MetaKnown:  true,
			RedisDB:    -1,
			StaleFor:   j.Age,
			StaleKnown: j.Age > 0,
			Reason:     j.Reason,
		})
	}
	return out
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

// jobLabel is what the picker calls a job: its own name when it has one, else
// its id. The id is always in the path shown beside it, so a named job reads as
// what it was for rather than as eight hex characters.
func jobLabel(j app.JobRow) string {
	if j.Name != "" {
		return j.Name
	}
	return j.ID
}

// report is the agent / non-TTY form: it runs the fast meta pass only
// (idle time, databases, dirty, origin-gone) and prints a plain table, marking
// with "*" the worktrees idle enough to be the default deletion set. It skips the
// slow per-worktree `du` sizing on purpose — an agent can't act on the picker
// anyway, and waiting on du across a large fleet would hang the command — so sizes
// are a terminal-only affordance. It deletes nothing.
func (r *cleanRun) report(ctx context.Context) error {
	d, threshold := r.d, r.threshold
	rows, err := d.orch.PlanPrune(d.worktree, d.worktree)
	if err != nil {
		return err
	}
	metas := make([]app.PruneMeta, len(rows))
	d.orch.ScanMeta(ctx, rows, func(i int, meta app.PruneMeta) { metas[i] = meta })

	fmt.Printf("haven clean — %s\n\n", domain.WorktreeKind.Count(len(rows)))
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
	fmt.Printf("\n* = pre-selected: idle ≥ %dd, or classified temporary / merged — %s.\n", days, domain.WorktreeKind.Count(defaults))
	r.jobReport()
	fmt.Println(strings.ToUpper(sharedResourcesNote[:1]) + sharedResourcesNote[1:] + ".")
	fmt.Println("Run `haven clean` in a terminal for the two pickers (worktrees, then job scratch); `haven clean --yes` reclaims build caches, orphan processes, temporary and merged worktrees, and cold job scratch — never a database.")
	return nil
}

// jobReport is the agent report's job-scratch section, counted and labelled
// on its own: which jobs are cold enough to reclaim now, which are held back as
// too recent, and how many are kept. Like the worktree table it deletes nothing
// and skips the per-job `du` — an agent cannot act on a picker, and sizing two
// hundred directories would hang the command.
func (r *cleanRun) jobReport() {
	d, scope := r.d, r.scope
	jobs, err := d.orch.PlanJobs()
	if err != nil {
		fmt.Printf("\nagent job scratch: unreadable (%v)\n", err)
		return
	}
	if len(jobs) == 0 {
		return
	}
	inScope := jobsInScope(jobs, scope)
	fmt.Printf("\nagent job scratch — %s, %s reclaimable\n\n",
		domain.JobScratchKind.Count(len(jobs)), domain.JobScratchKind.Count(len(inScope)))
	for _, j := range inScope {
		fmt.Printf(" * %-26s %-9s %s\n", truncateCell(jobLabel(j), 26), domain.HumanAge(j.Age), j.Reason)
	}
	if recent := len(reclaimableJobs(jobs)) - len(inScope); recent > 0 {
		fmt.Printf("   %s finished within %s — held back; pass --include-recent to reclaim them.\n",
			domain.JobScratchKind.Count(recent), domain.HumanAge(domain.JobScratchRecent))
	}
	if kept := len(jobs) - len(reclaimableJobs(jobs)); kept > 0 {
		fmt.Printf("   %s kept (in use, or still active).\n", domain.JobScratchKind.Count(kept))
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

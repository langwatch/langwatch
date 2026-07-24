package cmd

import (
	"context"
	"fmt"
	"os"
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

// runClean is `haven clean` — the one cleanup command. In a terminal it opens
// the interactive worktree picker (concurrent scan: disk size, databases, idle
// time; stale ones pre-ticked; deletes exactly what the user confirms, with the
// primary-checkout / running-from guards and database-drop safety of
// DestroyWorktree), then reclaims the safe categories — regenerable build
// artifacts of idle worktrees and orphaned dev processes — as part of the same
// run. `--yes` skips the picker and applies ONLY the safe categories, never a
// worktree deletion. Agents (and any non-TTY) get the read-only report and
// delete nothing without `--yes`.
func runClean(ctx context.Context, d deps, inv invocation) error {
	if inv.has("--yes") {
		if err := d.orch.Prune(ctx, d.worktree, true); err != nil {
			return err
		}
		reapOrphanRuntimes(d)
		reapOrphanPlays(ctx, d)
		return nil
	}
	threshold := pruneStaleThreshold(inv)
	rows, err := d.orch.PlanPrune(d.worktree, d.worktree)
	if err != nil {
		return err
	}
	if d.isAgent {
		return printPruneReport(ctx, d, rows, threshold)
	}
	if err := prunetui.Run(ctx, d.pruneActions(rows, threshold)); err != nil {
		return err
	}
	reapOrphanRuntimes(d)
	reapOrphanPlays(ctx, d)
	return nil
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
// (tsgo, node, pnpm, uv, python, opencode) that have been orphaned to pid 1 but
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
// picker asks for — the same wiring the hub uses.
func (d deps) pruneActions(rows []app.PruneRow, threshold time.Duration) prunetui.Actions {
	tuiRows := make([]prunetui.Row, len(rows))
	for i, r := range rows {
		tuiRows[i] = prunetui.Row{
			Dir:       r.Dir,
			Branch:    r.Branch,
			Slug:      r.Slug,
			IsPrimary: r.IsPrimary,
			IsCurrent: r.IsCurrent,
			IsLive:    r.IsLive,
			Deletable: r.Deletable(),
		}
	}
	return prunetui.Actions{
		Rows:      tuiRows,
		Threshold: threshold,
		Scan: func(ctx context.Context, onMeta func(int, prunetui.MetaResult), onSize func(int, int64)) {
			d.orch.ScanWorktrees(ctx, rows,
				func(i int, meta app.PruneMeta) {
					onMeta(i, prunetui.MetaResult{
						HasCHDB:    meta.HasCHDB,
						HasPGDB:    meta.HasPGDB,
						RedisDB:    meta.RedisDB,
						IsDirty:    meta.IsDirty,
						OriginGone: meta.OriginGone,
						StaleFor:   meta.StaleFor,
						StaleKnown: !meta.LastActive.IsZero(),
					})
				},
				onSize,
			)
		},
		DeleteAll: func(ctx context.Context, dirs []string, onDone func(dir string, err error)) {
			d.orch.DestroyWorktrees(ctx, d.worktree, dirs, d.worktree, onDone)
		},
		SharedNote: sharedResourcesNote,
	}
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

	fmt.Printf("haven prune — %d worktree(s)\n\n", len(rows))
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
	fmt.Printf("\n* = idle ≥ %dd and safe to delete — %d worktree(s).\n", days, defaults)
	fmt.Println(strings.ToUpper(sharedResourcesNote[:1]) + sharedResourcesNote[1:] + ".")
	fmt.Println("Run `haven prune` in a terminal to see sizes, sort, and delete; `haven prune --artifacts --yes` reclaims build caches without deleting worktrees.")
	return nil
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
	return strings.Join(flags, " · ")
}

func truncateCell(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

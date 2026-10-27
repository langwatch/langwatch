package app

import (
	"context"
	"path/filepath"
	"sort"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// ClaudeStateRow is one directory under the Claude home as a cleanup reports
// it: what it holds, which worktree it belongs to, and whether there is
// anything worth saying about its age and weight.
type ClaudeStateRow struct {
	domain.ClaudeStateFacts
	domain.ClaudeStateVerdict
}

// PlanClaudeState reads every cataloged directory under the Claude home and
// links the ones keyed by a path to the worktree they came from. It reads and
// decides only — nothing here removes anything, and nothing here is offered for
// removal. A home that is not configured, or a reader that is not wired, yields
// no rows rather than an error: this section is an addition to a cleanup report,
// never the reason it fails.
//
// Linking encodes each live worktree's path forward and compares (see
// domain.ClaudeProjectSlug); the directory name is never decoded, because the
// encoding folds a slash, a dot and a dash onto the same character.
func (o *Orchestrator) PlanClaudeState(ctx context.Context, repoRoot string) ([]ClaudeStateRow, error) {
	roots := o.claudeRoots()
	if o.claudeState == nil || len(roots) == 0 {
		return nil, nil
	}
	bySlug := o.worktreesBySlug(repoRoot)
	coldBefore := coldCutoff(o.sys.Now())

	var rows []ClaudeStateRow
	for _, loc := range domain.ClaudeLocations {
		root, ok := roots[loc.Root]
		if !ok {
			continue
		}
		records, err := o.claudeState.Read(ctx, domain.ClaudeScan{Root: root, Loc: loc, ColdBefore: coldBefore})
		if err != nil {
			o.log.Warn("claude state: location unreadable", zapErr(err))
			continue
		}
		for i := range records {
			rows = append(rows, claudeStateRow(records[i], loc, bySlug))
		}
	}
	sortClaudeState(rows)
	return rows, nil
}

// claudeStateRow attributes one record. A per-entry location can hold children
// that never encoded a path — a skills cache beside the project directories —
// and naming one after a worktree it never belonged to would be a guess, so it
// is reported as belonging to the installation instead.
func claudeStateRow(rec domain.ClaudeStateRecord, loc domain.ClaudeLocation, bySlug map[string]string) ClaudeStateRow {
	facts := domain.ClaudeStateFacts{
		ClaudeStateRecord: rec,
		Scope:             loc.Scope,
		Holds:             loc.Holds,
		Slugged:           loc.PerEntry && loc.Scope == domain.ClaudeScopeWorktree && domain.ClaudeNameIsPath(rec.Name),
	}
	switch {
	case facts.Slugged:
		facts.WorktreeDir = bySlug[rec.Name]
	case loc.PerEntry:
		facts.Scope = domain.ClaudeScopeMachine
	}
	return ClaudeStateRow{ClaudeStateFacts: facts, ClaudeStateVerdict: domain.ClassifyClaudeState(facts)}
}

// claudeRoots is where each cataloged location is looked for, omitting a root
// that is not configured. A missing root turns its locations off rather than
// resolving them against an empty path, which would walk the filesystem root.
func (o *Orchestrator) claudeRoots() map[domain.ClaudeStateRoot]string {
	roots := map[domain.ClaudeStateRoot]string{}
	if o.cfg.ClaudeHome != "" {
		roots[domain.ClaudeRootHome] = o.cfg.ClaudeHome
	}
	if o.cfg.ClaudeTmp != "" {
		roots[domain.ClaudeRootTmp] = o.cfg.ClaudeTmp
	}
	return roots
}

// worktreesBySlug indexes the live worktrees by the name Claude would give the
// directory it keeps their transcripts in. A repository git cannot enumerate
// yields an empty index, which reports every transcript directory as left
// behind — so the error is swallowed to a warning and the index stays empty
// only when git genuinely answered nothing.
func (o *Orchestrator) worktreesBySlug(repoRoot string) map[string]string {
	bySlug := map[string]string{}
	if o.hyg == nil {
		return bySlug
	}
	worktrees, err := o.hyg.Worktrees(repoRoot)
	if err != nil {
		o.log.Warn("claude state: worktree listing failed", zapErr(err))
		return bySlug
	}
	for _, wt := range worktrees {
		bySlug[domain.ClaudeProjectSlug(wt.Dir)] = wt.Dir
	}
	return bySlug
}

// sortClaudeState puts the rows with something to say at the top, heaviest cold
// share first, so the one line a reader takes in is the one that cost them the
// disk. Everything else follows in size order, as context rather than a list to
// work through.
func sortClaudeState(rows []ClaudeStateRow) {
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if (a.Notice != "") != (b.Notice != "") {
			return a.Notice != ""
		}
		if a.ColdBytes != b.ColdBytes {
			return a.ColdBytes > b.ColdBytes
		}
		return a.Bytes > b.Bytes
	})
}

// ClaudeStateLeftBy reports what a removed worktree leaves behind: the
// transcripts in the Claude home and the working files in the temp root, each
// with where it is and how much it weighs. Empty when there is nothing. It is
// what a cleanup prints after deleting a worktree — those directories outlive
// the checkout by design, and saying so beats discovering them a year later
// under a name nobody can trace back to a branch.
func (o *Orchestrator) ClaudeStateLeftBy(ctx context.Context, worktreeDir string) []domain.ClaudeStateRecord {
	if o.claudeState == nil || worktreeDir == "" {
		return nil
	}
	slug := domain.ClaudeProjectSlug(worktreeDir)
	roots := o.claudeRoots()
	coldBefore := coldCutoff(o.sys.Now())

	var out []domain.ClaudeStateRecord
	for _, loc := range domain.ClaudeLocations {
		dir, ok := claudeWorktreeDir(loc, roots, slug)
		if !ok {
			continue
		}
		if rec, found := o.claudeState.Stat(ctx, dir, coldBefore); found && rec.Bytes > 0 {
			out = append(out, rec)
		}
	}
	return out
}

// claudeWorktreeDir is where one location would keep a given worktree's
// directory, and false for a location that is not keyed by a worktree path or
// whose root is not configured.
func claudeWorktreeDir(loc domain.ClaudeLocation, roots map[domain.ClaudeStateRoot]string, slug string) (string, bool) {
	if loc.Scope != domain.ClaudeScopeWorktree || !loc.PerEntry {
		return "", false
	}
	root, ok := roots[loc.Root]
	if !ok {
		return "", false
	}
	return filepath.Join(root, loc.Name, slug), true
}

// coldCutoff is the instant before which a file counts as old, exposed so the
// report and the left-behind line measure the same thing.
func coldCutoff(now time.Time) time.Time { return now.Add(-domain.ClaudeStateCold) }

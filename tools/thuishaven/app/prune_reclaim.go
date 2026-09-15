package app

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// ReclaimableWorktree is one worktree the classification says may go ahead of the
// idle clock, with the reason it says so.
type ReclaimableWorktree struct {
	Dir    string
	Branch string
	Class  domain.WorktreeClass
	Reason string
}

// PlanReclaimableWorktrees runs the meta pass over repoRoot's worktrees and
// returns only the ones classified temporary or merged. Every guard is inside
// the classification: the primary checkout, the worktree haven runs from, a
// running stack, and any uncommitted change all disqualify a worktree here, so
// there is no second place a caller could forget one.
func (o *Orchestrator) PlanReclaimableWorktrees(ctx context.Context, repoRoot, selfDir string) ([]ReclaimableWorktree, error) {
	rows, err := o.PlanPrune(repoRoot, selfDir)
	if err != nil {
		return nil, err
	}
	metas := make([]PruneMeta, len(rows))
	o.ScanMeta(ctx, rows, func(i int, meta PruneMeta) { metas[i] = meta })

	var out []ReclaimableWorktree
	for i, r := range rows {
		if metas[i].Class == domain.ClassNone {
			continue
		}
		out = append(out, ReclaimableWorktree{
			Dir: r.Dir, Branch: r.Branch, Class: metas[i].Class, Reason: metas[i].Reason,
		})
	}
	return out, nil
}

// ReclaimClassifiedWorktrees removes every temporary and merged worktree,
// reporting each outcome to onDone. It is the one unattended worktree removal —
// the daemon's daily pass and `haven clean --yes` both go through it, so neither
// can drift into doing more than the other.
//
// It removes the directory and git's admin entry and NOTHING else. In
// particular it does not touch the worktree's ClickHouse and Postgres
// databases, which the interactive picker's DestroyWorktrees does: a database is
// not regenerable, so it may only be dropped by a path that has shown the
// operator exactly which databases are in scope (ADR-064). What this does remove
// is regenerable by definition — a temporary worktree is scratch a tool makes on
// demand, and a merged one's commits are already on origin/main.
// selfDir takes the same value as repoRoot: on both paths the checkout haven is
// running in IS the one it enumerates, and passing it twice only invited the two
// to disagree.
func (o *Orchestrator) ReclaimClassifiedWorktrees(ctx context.Context, repoRoot string, onDone func(ReclaimableWorktree, error)) {
	if o.hyg == nil || repoRoot == "" {
		return
	}
	candidates, err := o.PlanReclaimableWorktrees(ctx, repoRoot, repoRoot)
	if err != nil {
		o.log.Warn("worktree reclaim: could not plan", zap.Error(err))
		return
	}
	removedAny := false
	for _, c := range candidates {
		rerr := o.hyg.RemoveWorktree(repoRoot, c.Dir)
		if rerr == nil {
			removedAny = true
			o.recordReap("worktree", c.Dir, c.Reason)
			o.log.Info("reclaimed worktree",
				zap.String("dir", c.Dir), zap.String("branch", c.Branch),
				zap.String("class", string(c.Class)), zap.String("reason", c.Reason))
		}
		if onDone != nil {
			onDone(c, rerr)
		}
	}
	if removedAny {
		o.hyg.PruneGitWorktrees(repoRoot)
	}
}

// reapReclaimableWorktrees is the daemon's daily worktree pass: the same
// reclaim, with failures logged rather than printed.
func (o *Orchestrator) reapReclaimableWorktrees(ctx context.Context) {
	o.ReclaimClassifiedWorktrees(ctx, o.cfg.RepoRoot, func(c ReclaimableWorktree, err error) {
		if err != nil {
			o.log.Warn("worktree reclaim failed", zap.String("dir", c.Dir), zap.Error(err))
		}
	})
}

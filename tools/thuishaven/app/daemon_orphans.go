package app

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// orphanTerm is one SIGTERM the sweep sent: the process's start (pid plus
// start is its identity) and when it was asked to go.
type orphanTerm struct {
	started time.Time
	at      time.Time
}

// orphanTarget is one tree the sweep reclaims: its root and why.
type orphanTarget struct {
	root   ProcessSample
	cwd    string
	reason string
}

// sweepRepoOrphans reclaims checkout dev tooling nobody owns any more: PPID-1
// trees past Grace and compiler runs past TypecheckMaxAge, never inside a
// registered stack's tree or the daemon's own. Roots go first (a restart loop
// cannot respawn), then descendants; a later sweep SIGKILLs what ignored TERM.
func (o *Orchestrator) sweepRepoOrphans() {
	l := o.cfg.Orphans
	now := o.sys.Now()
	if l.Grace <= 0 && l.TypecheckMaxAge <= 0 {
		return
	}
	if !o.orphanSweptAt.IsZero() && now.Sub(o.orphanSweptAt) < l.Every {
		return
	}
	o.orphanSweptAt = now
	samples := o.processSamples()
	byPID, children := processTree(samples)
	killed := o.killIgnoredTerms(byPID, now)
	roots := o.orphanRoots()
	if len(roots) == 0 {
		return
	}
	for _, t := range o.orphanTargets(samples, byPID, children, roots, killed) {
		o.terminateTree(t, children, byPID, now)
	}
}

// orphanRoots are the checkout roots, every git worktree of the repository
// and every registered stack's worktree.
func (o *Orchestrator) orphanRoots() []string {
	roots := append([]string(nil), o.cfg.BrowserOwnerRoots...)
	roots = append(roots, o.repoWorktrees()...)
	for _, s := range o.store.Stacks() {
		if s.WorktreeDir != "" {
			roots = append(roots, s.WorktreeDir)
		}
	}
	return roots
}

// repoWorktrees lists the repository's worktrees, cached; a failed listing
// keeps the last good one.
func (o *Orchestrator) repoWorktrees() []string {
	now := o.sys.Now()
	if o.hyg == nil || o.cfg.RepoRoot == "" || (!o.orphanWorktreesAt.IsZero() && now.Sub(o.orphanWorktreesAt) < worktreeIdleTTL) {
		return o.orphanWorktrees
	}
	o.orphanWorktreesAt = now
	worktrees, err := o.hyg.Worktrees(o.cfg.RepoRoot)
	if err != nil {
		return o.orphanWorktrees
	}
	o.orphanWorktrees = o.orphanWorktrees[:0]
	for _, wt := range worktrees {
		o.orphanWorktrees = append(o.orphanWorktrees, wt.Dir)
	}
	return o.orphanWorktrees
}

// orphanTargets applies both rules, then reads cwds for the few survivors.
func (o *Orchestrator) orphanTargets(samples []ProcessSample, byPID map[int]ProcessSample, children map[int][]int, roots []string, killed map[int]bool) []orphanTarget {
	protected := o.protectedTrees(byPID, children)
	l := o.cfg.Orphans
	var candidates []orphanTarget
	for _, s := range samples {
		if protected[s.PID] || s.PID <= 1 {
			continue
		}
		if _, termed := o.orphanTermed[s.PID]; termed || killed[s.PID] {
			continue
		}
		switch {
		case l.Grace > 0 && s.PPID == 1 && s.Elapsed >= l.Grace && domain.IsOrphanCandidate(s.Command):
			candidates = append(candidates, orphanTarget{root: s, reason: fmt.Sprintf("parented to PID 1 outside every stack for over %s", l.Grace)})
		case l.TypecheckMaxAge > 0 && s.Elapsed >= l.TypecheckMaxAge && domain.IsLongTypecheckCandidate(s.Command):
			candidates = append(candidates, orphanTarget{root: s, reason: fmt.Sprintf("typecheck running longer than %s", l.TypecheckMaxAge)})
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	pids := make([]int, len(candidates))
	for i, c := range candidates {
		pids[i] = c.root.PID
	}
	cwds := o.sys.ProcessCwds(pids)
	var out []orphanTarget
	for _, c := range candidates {
		c.cwd = cwds[c.root.PID]
		if domain.UnderRoots(c.cwd, roots) || domain.MentionsRoot(c.root.Command, roots) {
			out = append(out, c)
		}
	}
	return out
}

// protectedTrees is every pid under a registered stack's launcher or owner,
// and under the daemon itself: the sweep never reaches into a live stack.
func (o *Orchestrator) protectedTrees(byPID map[int]ProcessSample, children map[int][]int) map[int]bool {
	heads := []int{o.sys.Getpid()}
	for _, s := range o.store.Stacks() {
		heads = append(heads, s.LauncherPID, s.OwnerPID)
	}
	protected := map[int]bool{}
	for _, head := range heads {
		if head <= 1 {
			continue
		}
		for _, pid := range treeOf(head, children) {
			protected[pid] = true
		}
	}
	return protected
}

// treeOf is root and every descendant, root first, parents before children.
func treeOf(root int, children map[int][]int) []int {
	out := []int{root}
	seen := map[int]bool{root: true}
	for i := 0; i < len(out); i++ {
		for _, child := range children[out[i]] {
			if !seen[child] {
				seen[child] = true
				out = append(out, child)
			}
		}
	}
	return out
}

// terminateTree SIGTERMs t's root, then its descendants, and records the reap.
func (o *Orchestrator) terminateTree(t orphanTarget, children map[int][]int, byPID map[int]ProcessSample, now time.Time) {
	if o.orphanTermed == nil {
		o.orphanTermed = map[int]orphanTerm{}
	}
	tree := treeOf(t.root.PID, children)
	var rss int64
	for _, pid := range tree {
		s := byPID[pid]
		rss += s.RSSBytes
		o.sys.Terminate(pid)
		o.orphanTermed[pid] = orphanTerm{started: now.Add(-s.Elapsed), at: now}
	}
	target := fmt.Sprintf("pid %d (%s; %d process(es), %s, up %s%s)",
		t.root.PID, shortCommand(t.root.Command), len(tree), domain.HumanBytes(rss),
		t.root.Elapsed.Truncate(time.Minute), cwdSuffix(t.cwd))
	o.recordReap(domain.OrphanClass, target, t.reason)
	o.log.Info("reclaimed orphaned dev tooling", zap.Int("pid", t.root.PID), zap.Int("tree", len(tree)), zap.String("reason", t.reason))
}

// killIgnoredTerms SIGKILLs every termed process still alive past KillGrace,
// and forgets the ones that went (or whose pid now names another process).
// It returns the pids it just killed: this sweep's samples still list them,
// and they are not new orphans. Reported once, at the SIGTERM; debug here.
func (o *Orchestrator) killIgnoredTerms(byPID map[int]ProcessSample, now time.Time) map[int]bool {
	killed := map[int]bool{}
	for pid, term := range o.orphanTermed {
		s, alive := byPID[pid]
		if !alive || now.Add(-s.Elapsed).Sub(term.started).Abs() > 5*time.Second {
			delete(o.orphanTermed, pid)
			continue
		}
		if now.Sub(term.at) >= o.cfg.Orphans.KillGrace {
			o.sys.Kill(pid)
			o.log.Debug("force-killed orphaned dev tooling that ignored SIGTERM", zap.Int("pid", pid))
			killed[pid] = true
			delete(o.orphanTermed, pid)
		}
	}
	return killed
}

// shortCommand is the binary's base name and the start of its arguments.
func shortCommand(command string) string {
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return ""
	}
	fields[0] = filepath.Base(fields[0])
	short := strings.Join(fields, " ")
	if len(short) > 60 {
		short = short[:60] + "…"
	}
	return short
}

func cwdSuffix(cwd string) string {
	if cwd == "" {
		return ""
	}
	return ", in " + cwd
}

package app

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// DownStack stops a registered stack by slug, from anywhere: it terminates the
// launcher (the supervised children die with their process group), removes the
// stack's routes, and drops its registry entry. Databases are deliberately
// kept — stopping someone's stack from the hub must not silently discard their
// data; that is what DestroyWorktree is for.
func (o *Orchestrator) DownStack(ctx context.Context, slug string) error {
	st, ok := o.stackBySlug(slug)
	if !ok {
		return fmt.Errorf("no registered stack %q", slug)
	}
	if o.sys.ProcessAlive(st.LauncherPID) {
		o.sys.Terminate(st.LauncherPID)
	}
	for _, svc := range st.Services {
		o.proxy.Remove(svc.Name, slug)
	}
	o.store.RemoveStack(slug)
	return nil
}

// DestroyWorktree is the hub's full wipe: stop any stack running from the
// worktree, drop its ClickHouse + Postgres databases (the protected main
// database is always kept), and remove the worktree directory itself — even a
// dirty one, because the caller has already confirmed by typing the name. Two
// targets are never destroyable: the repository's primary checkout and the
// worktree haven itself was launched from (selfDir).
func (o *Orchestrator) DestroyWorktree(ctx context.Context, repoRoot, dir, selfDir string) error {
	if o.hyg == nil {
		return fmt.Errorf("hygiene adapter not wired")
	}
	worktrees, err := o.hyg.Worktrees(repoRoot)
	if err != nil {
		return fmt.Errorf("listing worktrees: %w", err)
	}
	if len(worktrees) > 0 && worktrees[0].Dir == dir {
		return fmt.Errorf("refusing to destroy %s — it is the repository's primary checkout", dir)
	}
	if dir == selfDir {
		return fmt.Errorf("refusing to destroy %s — haven is running from it", dir)
	}
	if !isKnownWorktree(worktrees, dir) {
		return fmt.Errorf("%s is not a worktree of this repository", dir)
	}

	for _, st := range o.store.Stacks() {
		if st.WorktreeDir != dir {
			continue
		}
		if err := o.DownStack(ctx, st.Slug); err != nil {
			o.log.Warn("destroy: down failed (continuing)", zap.String("slug", st.Slug), zap.Error(err))
		}
	}
	o.pruneDatabases(ctx, dir, true)
	if err := o.hyg.RemoveWorktree(repoRoot, dir); err != nil {
		return fmt.Errorf("removing worktree: %w", err)
	}
	o.hyg.PruneGitWorktrees(repoRoot)
	return nil
}

// HubStack is one row of the hub TUI: a registered stack plus the live facts
// (health, footprint) the TUI shows and the directory its actions operate on.
type HubStack struct {
	Stack   domain.Stack
	IsLive  bool
	RSS     uint64
	PortsUp int
}

// HubStacks assembles the hub rows from the registry + live probes.
func (o *Orchestrator) HubStacks() []HubStack {
	var rows []HubStack
	for _, st := range o.store.Stacks() {
		row := HubStack{Stack: st, IsLive: o.sys.ProcessAlive(st.LauncherPID)}
		if row.IsLive {
			row.RSS = o.sys.GroupRSS(st.LauncherPID)
		}
		for _, svc := range st.Services {
			if svc.Port != 0 && o.sys.PortInUse(svc.Port) {
				row.PortsUp++
			}
		}
		rows = append(rows, row)
	}
	return rows
}

func (o *Orchestrator) stackBySlug(slug string) (domain.Stack, bool) {
	for _, st := range o.store.Stacks() {
		if st.Slug == slug {
			return st, true
		}
	}
	return domain.Stack{}, false
}

func isKnownWorktree(worktrees []Worktree, dir string) bool {
	for _, wt := range worktrees {
		if wt.Dir == dir {
			return true
		}
	}
	return false
}

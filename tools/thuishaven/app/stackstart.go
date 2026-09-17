package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// StartWorktreeStack brings up the stack for a worktree that has none, without
// waiting for it: `haven up` supervises its children for as long as the stack
// lives, so the caller gets an answer the moment the launcher is spawned rather
// than minutes later. Progress is read where it always is — the registry the
// launcher writes itself into, which the dashboard is already polling.
//
// The directory is not taken on trust. It is matched against `git worktree
// list` for this repository, so the only paths that can be started are ones git
// already knows about: this is reachable from a browser POST, and a path
// straight from a request body is a path that spawns a process wherever the
// request says.
func (o *Orchestrator) StartWorktreeStack(worktreeDir string) error {
	if o.sys == nil || len(o.cfg.UpArgv) == 0 {
		return fmt.Errorf("this haven cannot start a stack for another worktree")
	}
	dir, err := o.knownWorktree(worktreeDir)
	if err != nil {
		return err
	}
	if st, ok := o.stackByDir(dir); ok && o.sys.ProcessAlive(st.LauncherPID) {
		return fmt.Errorf("a stack is already running in %s", filepath.Base(dir))
	}
	return o.sys.SpawnDetached(o.cfg.UpArgv, dir, filepath.Join(o.cfg.Home, "up-from-dashboard.log"))
}

// knownWorktree resolves a requested directory to the canonical path git lists
// for it, and refuses anything git does not list. Canonicalising both sides
// means a symlinked or case-variant spelling of a real worktree is accepted as
// itself rather than rejected — and that a path which merely looks like one is
// still refused.
func (o *Orchestrator) knownWorktree(dir string) (string, error) {
	if o.hyg == nil {
		return "", fmt.Errorf("this haven cannot enumerate worktrees")
	}
	worktrees, err := o.hyg.Worktrees(o.cfg.RepoRoot)
	if err != nil {
		return "", fmt.Errorf("listing worktrees: %w", err)
	}
	wanted := canonicalPath(dir)
	for _, wt := range worktrees {
		if canonicalPath(wt.Dir) == wanted {
			return wt.Dir, nil
		}
	}
	return "", fmt.Errorf("%q is not a worktree of this repository", dir)
}

// stackByDir finds the registered stack running from a directory, if any.
func (o *Orchestrator) stackByDir(dir string) (domain.Stack, bool) {
	stacks := o.store.Stacks()
	for i := range stacks {
		if canonicalPath(stacks[i].WorktreeDir) == canonicalPath(dir) {
			return stacks[i], true
		}
	}
	return domain.Stack{}, false
}

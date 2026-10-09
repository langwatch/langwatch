package app

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/tools/seedgen"
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

// StartStackService adds one service to a running stack: `haven up +<service>`
// detached in its worktree. The selection is sticky, so up restarts the stack
// with the service added; progress is read from the registry, as for Start.
func (o *Orchestrator) StartStackService(slug, service string) error {
	if !slices.Contains(domain.SelectableServices, service) {
		return fmt.Errorf("unknown service %q", service)
	}
	dir, err := o.registeredWorktree(slug)
	if err != nil {
		return err
	}
	argv := append(slices.Clone(o.cfg.UpArgv), "+"+service)
	return o.sys.SpawnDetached(argv, dir, filepath.Join(o.cfg.Home, "up-from-dashboard.log"))
}

// ResetStackDatabases runs `haven db reset --yes` detached in a stack's
// worktree. The slug is pinned in the child's env: an inherited LANGWATCH_SLUG
// must not make the reset drop a different stack's databases.
func (o *Orchestrator) ResetStackDatabases(slug string) error {
	dir, err := o.registeredWorktree(slug)
	if err != nil {
		return err
	}
	haven := o.cfg.UpArgv[:len(o.cfg.UpArgv)-1]
	argv := append([]string{"/usr/bin/env", "LANGWATCH_SLUG=" + slug}, haven...)
	argv = append(argv, "db", "reset", "--yes")
	return o.sys.SpawnDetached(argv, dir, filepath.Join(o.cfg.Home, "reset-from-dashboard.log"))
}

// registeredWorktree is the worktree a registered stack runs from, checked
// against git's list the same way Start checks a requested directory.
func (o *Orchestrator) registeredWorktree(slug string) (string, error) {
	if o.sys == nil || len(o.cfg.UpArgv) == 0 {
		return "", fmt.Errorf("this haven cannot act on another worktree's stack")
	}
	st, ok := o.stackBySlug(slug)
	if !ok || st.WorktreeDir == "" {
		return "", fmt.Errorf("no stack is registered for %q", slug)
	}
	return o.knownWorktree(st.WorktreeDir)
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

// SeedStack runs `haven seed --size <size> --persona <persona>` detached in a
// stack's worktree, for the stack home's seed console. The flags are checked by
// seedgen's own parser first, so a bad request spawns nothing; the slug is
// pinned as for ResetStackDatabases.
func (o *Orchestrator) SeedStack(slug, size, persona string) error {
	args := []string{"--size", size, "--persona", persona}
	if _, err := seedgen.ParseFlags(args, o.sys.Now().UTC()); err != nil {
		return err
	}
	if st, ok := o.readSeedStatus(slug); ok && st.State == "running" && o.sys.ProcessAlive(st.PID) {
		return fmt.Errorf("a seed is already running on %s", slug)
	}
	dir, err := o.registeredWorktree(slug)
	if err != nil {
		return err
	}
	haven := o.cfg.UpArgv[:len(o.cfg.UpArgv)-1]
	argv := append([]string{"/usr/bin/env", "LANGWATCH_SLUG=" + slug}, haven...)
	argv = append(append(argv, "seed"), args...)
	logPath := o.seedConsoleLog(slug)
	if err := os.MkdirAll(filepath.Dir(logPath), 0o750); err != nil {
		return err
	}
	_ = os.Remove(logPath) // each console run's log starts empty
	return o.sys.SpawnDetached(argv, dir, logPath)
}

// seedConsoleLog is where a seed started from the stack home writes its output.
func (o *Orchestrator) seedConsoleLog(slug string) string {
	return filepath.Join(o.cfg.Home, "seed", slug+"-console.log")
}

// seedConsoleTail is how many of the seed log's last lines the console shows.
const seedConsoleTail = 12

// SeedReport is the seed console's view of a stack: the `haven status` seed
// line ("" when it never ran) and the last lines of a console-started run.
func (o *Orchestrator) SeedReport(slug string) (string, []string) {
	data, _ := os.ReadFile(o.seedConsoleLog(slug))
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	if len(lines) > seedConsoleTail {
		lines = lines[len(lines)-seedConsoleTail:]
	}
	if len(lines) == 1 && lines[0] == "" {
		lines = nil
	}
	return o.SeedStatusLine(slug), lines
}

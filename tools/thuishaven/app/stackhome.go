package app

import (
	"go.uber.org/zap"
)

// registerStackHome routes <slug>.langwatch.localhost to the daemon, which
// serves the worktree's home page (ADR-160). The route outlives the stack's
// own: a stopped stack's home still answers, and only pruning takes it away.
func (o *Orchestrator) registerStackHome(slug string, daemonPort int) {
	name, ok := o.cfg.Naming.StackHomeService(slug)
	if !ok || o.cfg.PortlessDisabled || daemonPort == 0 {
		return
	}
	if err := o.proxy.Register(name, "", daemonPort); err != nil {
		o.log.Warn("stack home registration failed", zap.String("slug", slug), zap.Error(err))
	}
}

// registerStackHomeWithDaemon is registerStackHome at the running daemon's
// port, for `up`: the daemon was ensured just before the stack provisions.
func (o *Orchestrator) registerStackHomeWithDaemon(slug string) {
	if info, ok := o.store.Daemon(); ok {
		o.registerStackHome(slug, info.Port)
	}
}

// removeStackHome takes a pruned worktree's home route away.
func (o *Orchestrator) removeStackHome(slug string) {
	if name, ok := o.cfg.Naming.StackHomeService(slug); ok && !o.cfg.PortlessDisabled {
		o.proxy.Remove(name, "")
	}
}

// stackHomeSlugs are the slugs with a home: every registered stack, and every
// worktree haven has named whose stack is down.
func (o *Orchestrator) stackHomeSlugs() []string {
	stacks := o.store.Stacks()
	seen := map[string]bool{}
	var slugs []string
	add := func(slug string) {
		if slug != "" && !seen[slug] {
			seen[slug] = true
			slugs = append(slugs, slug)
		}
	}
	for i := range stacks {
		add(stacks[i].Slug)
	}
	for _, wt := range o.hubWorktrees(o.cfg.RepoRoot, "", stacks) {
		add(wt.Slug)
	}
	return slugs
}

// routeStackHomes points every home at a daemon that has just taken a new
// port, since a route left at the previous daemon's port reaches nothing.
func (o *Orchestrator) routeStackHomes(daemonPort int) {
	for _, slug := range o.stackHomeSlugs() {
		o.registerStackHome(slug, daemonPort)
	}
}

// unrouteStackHomes is the daemon's exit: the homes go with the process that
// serves them, as the hub's own route does, and the next daemon restores them.
func (o *Orchestrator) unrouteStackHomes() {
	for _, slug := range o.stackHomeSlugs() {
		o.removeStackHome(slug)
	}
}

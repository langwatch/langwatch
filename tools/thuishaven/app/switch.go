package app

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// SwitchTarget is one place `haven switch` can take you: a name (the stack slug
// when one is registered, else the worktree's directory name) and its directory.
type SwitchTarget struct {
	Name string
	Dir  string
	IsUp bool
}

// SwitchTargets lists everywhere switch can go: every registered stack plus
// every git worktree of the repo, deduplicated by directory, up stacks first
// then alphabetical — the order completion offers them in.
func (o *Orchestrator) SwitchTargets(repoRoot string) []SwitchTarget {
	byDir := map[string]SwitchTarget{}
	if o.hyg != nil {
		if worktrees, err := o.hyg.Worktrees(repoRoot); err == nil {
			for _, wt := range worktrees {
				d := canonicalPath(wt.Dir)
				byDir[d] = SwitchTarget{Name: filepath.Base(wt.Dir), Dir: wt.Dir}
			}
		}
	}
	for _, st := range o.store.Stacks() {
		d := canonicalPath(st.WorktreeDir)
		byDir[d] = SwitchTarget{Name: st.Slug, Dir: st.WorktreeDir, IsUp: o.sys.ProcessAlive(st.LauncherPID)}
	}
	out := make([]SwitchTarget, 0, len(byDir))
	for _, t := range byDir {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsUp != out[j].IsUp {
			return out[i].IsUp
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// ResolveSwitch finds the directory `haven switch <query>` should land in:
// exact name first, then a unique prefix match, then a unique substring match —
// so `haven switch otel` reaches otel-haven as long as nothing else matches.
func (o *Orchestrator) ResolveSwitch(repoRoot, query string) (string, error) {
	targets := o.SwitchTargets(repoRoot)
	if len(targets) == 0 {
		return "", fmt.Errorf("no stacks or worktrees to switch to")
	}
	for _, t := range targets {
		if t.Name == query {
			return t.Dir, nil
		}
	}
	match := func(pred func(SwitchTarget) bool) []SwitchTarget {
		var hits []SwitchTarget
		for _, t := range targets {
			if pred(t) {
				hits = append(hits, t)
			}
		}
		return hits
	}
	for _, hits := range [][]SwitchTarget{
		match(func(t SwitchTarget) bool { return strings.HasPrefix(t.Name, query) }),
		match(func(t SwitchTarget) bool { return strings.Contains(t.Name, query) }),
	} {
		if len(hits) == 1 {
			return hits[0].Dir, nil
		}
		if len(hits) > 1 {
			var names []string
			for _, h := range hits {
				names = append(names, h.Name)
			}
			return "", fmt.Errorf("%q is ambiguous — matches: %s", query, strings.Join(names, ", "))
		}
	}
	var names []string
	for _, t := range targets {
		names = append(names, t.Name)
	}
	return "", fmt.Errorf("no worktree matches %q — available: %s", query, strings.Join(names, ", "))
}

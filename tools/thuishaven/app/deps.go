package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// ensureDeps installs node dependencies when the lockfile is newer than the
// last install — pnpm stamps node_modules/.modules.yaml, so "lockfile newer
// than the stamp" (or no stamp at all) means a checkout or branch switch left
// node_modules stale. Part of up's automatic preparation: a failed install
// fails the up, because every service would otherwise fail later and worse.
//
// Takes the WORKSPACE ROOT, not langwatch/. Since ADR-076 the repo is a single
// pnpm workspace: the lockfile and node_modules live at the root and langwatch/
// has neither. Pointed at langwatch/ this silently did nothing at all —
// depsStale found no lockfile there and read that as "nothing to install", so
// a fresh worktree started every service against absent dependencies.
//
// withLifecycleScripts must be false whenever the checkout's package.json is not
// this repo's own — a play sandbox of a fork PR, most of all. This repo has a
// postinstall, and a fork controls package scripts, so a plain install executes
// fork-authored code with the developer's environment and credentials before a
// single service starts. `haven pr` has always guarded this (see installDeps in
// pr.go); play must guard it the same way.
func (o *Orchestrator) ensureDeps(ctx context.Context, rootDir string, withLifecycleScripts bool) error {
	if !depsStale(rootDir) {
		return nil
	}
	install := "pnpm -s install"
	if !withLifecycleScripts {
		install = "pnpm -s install --ignore-scripts"
		fmt.Println("  dependencies: installing with --ignore-scripts (untrusted checkout: its lifecycle scripts will not run)…")
	} else {
		fmt.Println("  dependencies: lockfile changed since the last install — running pnpm install…")
	}
	if err := o.sup.RunOnce(ctx, "deps", rootDir, install, nil); err != nil {
		return fmt.Errorf("pnpm install failed: %w", err)
	}
	return nil
}

// depsStale reports whether rootDir's installed modules predate its lockfile.
// No lockfile means nothing to install; no stamp means never installed.
//
// rootDir is the workspace root — the only place either file exists since
// ADR-076.
func depsStale(rootDir string) bool {
	lock, err := os.Stat(filepath.Join(rootDir, "pnpm-lock.yaml"))
	if err != nil {
		return false
	}
	stamp, err := os.Stat(filepath.Join(rootDir, "node_modules", ".modules.yaml"))
	if err != nil {
		return true
	}
	return lock.ModTime().After(stamp.ModTime())
}

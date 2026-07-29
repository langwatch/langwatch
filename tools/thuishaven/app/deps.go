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
// withLifecycleScripts must be false whenever the checkout's package.json is not
// this repo's own — a play sandbox of a fork PR, most of all. This repo has a
// postinstall, and a fork controls package scripts, so a plain install executes
// fork-authored code with the developer's environment and credentials before a
// single service starts. `haven pr` has always guarded this (see installDeps in
// pr.go); play must guard it the same way.
func (o *Orchestrator) ensureDeps(ctx context.Context, lwDir string, withLifecycleScripts bool) error {
	if !depsStale(lwDir) {
		return nil
	}
	install := "pnpm -s install"
	if !withLifecycleScripts {
		install = "pnpm -s install --ignore-scripts"
		fmt.Println("  dependencies: installing with --ignore-scripts (untrusted checkout: its lifecycle scripts will not run)…")
	} else {
		fmt.Println("  dependencies: lockfile changed since the last install — running pnpm install…")
	}
	if err := o.sup.RunOnce(ctx, "deps", lwDir, install, nil); err != nil {
		return fmt.Errorf("pnpm install failed: %w", err)
	}
	return nil
}

// depsStale reports whether lwDir's installed modules predate its lockfile.
// No lockfile means nothing to install; no stamp means never installed.
func depsStale(lwDir string) bool {
	lock, err := os.Stat(filepath.Join(lwDir, "pnpm-lock.yaml"))
	if err != nil {
		return false
	}
	stamp, err := os.Stat(filepath.Join(lwDir, "node_modules", ".modules.yaml"))
	if err != nil {
		return true
	}
	return lock.ModTime().After(stamp.ModTime())
}

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
func (o *Orchestrator) ensureDeps(ctx context.Context, lwDir string) error {
	if !depsStale(lwDir) {
		return nil
	}
	fmt.Println("  dependencies: lockfile changed since the last install — running pnpm install…")
	if err := o.sup.RunOnce(ctx, "deps", lwDir, "pnpm -s install", nil); err != nil {
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

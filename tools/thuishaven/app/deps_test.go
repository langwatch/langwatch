package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// @scenario "Stale dependencies install themselves"
func TestDepsStale(t *testing.T) {
	write := func(t *testing.T, dir, rel string, mtime time.Time) {
		t.Helper()
		path := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, mtime, mtime); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()

	t.Run("given no lockfile, nothing is stale", func(t *testing.T) {
		if depsStale(t.TempDir()) {
			t.Error("a directory with no lockfile has nothing to install")
		}
	})

	t.Run("given a lockfile and no install stamp, deps are stale", func(t *testing.T) {
		dir := t.TempDir()
		write(t, dir, "pnpm-lock.yaml", now)
		if !depsStale(dir) {
			t.Error("never-installed modules are stale")
		}
	})

	t.Run("given the stamp is newer than the lockfile, deps are fresh", func(t *testing.T) {
		dir := t.TempDir()
		write(t, dir, "pnpm-lock.yaml", now.Add(-time.Hour))
		write(t, dir, "node_modules/.modules.yaml", now)
		if depsStale(dir) {
			t.Error("an install after the last lockfile change is fresh")
		}
	})

	t.Run("given the lockfile changed after the last install, deps are stale", func(t *testing.T) {
		dir := t.TempDir()
		write(t, dir, "node_modules/.modules.yaml", now.Add(-time.Hour))
		write(t, dir, "pnpm-lock.yaml", now)
		if !depsStale(dir) {
			t.Error("a lockfile newer than the install stamp is stale")
		}
	})
}

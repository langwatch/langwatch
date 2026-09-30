package workerpool

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLockSessionsRootRefusesASecondManager(t *testing.T) {
	root := filepath.Join(t.TempDir(), "sessions")

	first, err := lockSessionsRoot(root)
	if err != nil {
		t.Fatalf("first lock failed: %v", err)
	}
	defer first.Release()

	if _, err := lockSessionsRoot(root); err == nil {
		t.Fatal("a second manager took the same sessions root; the boot wipe would destroy live worker homes")
	}
}

func TestLockSessionsRootIsFreeAgainAfterRelease(t *testing.T) {
	root := filepath.Join(t.TempDir(), "sessions")

	first, err := lockSessionsRoot(root)
	if err != nil {
		t.Fatalf("first lock failed: %v", err)
	}
	first.Release()

	second, err := lockSessionsRoot(root)
	if err != nil {
		t.Fatalf("lock after release failed: %v", err)
	}
	second.Release()
}

func TestWipeSessionsRootEmptiesTheTreeAndKeepsTheLock(t *testing.T) {
	root := t.TempDir()
	lock, err := lockSessionsRoot(root)
	if err != nil {
		t.Fatalf("lock failed: %v", err)
	}
	defer lock.Release()

	stash := filepath.Join(root, ".pi-sessions", "langyconv_1")
	if err := os.MkdirAll(stash, 0o700); err != nil {
		t.Fatalf("seed stash: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "langyconv_1"), 0o700); err != nil {
		t.Fatalf("seed home: %v", err)
	}

	if err := wipeSessionsRoot(root); err != nil {
		t.Fatalf("wipe failed: %v", err)
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("read root: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != sessionsRootLockName {
		names := make([]string, 0, len(entries))
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		t.Fatalf("sessions root holds %v, want only %s", names, sessionsRootLockName)
	}
}

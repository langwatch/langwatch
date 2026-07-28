package workerpool

import (
	"context"
	"os/exec"
	"testing"
)

// The reaper's Wait4(-1, ...) matches ANY child of the process, not just a
// reparented orphan. The manager always has direct children (the worker
// subprocesses), so off PID 1 an ungated reaper races Pool.spawnInner's exit
// watcher and can reap a worker before cmd.Wait() sees it — turning a clean
// exit into "waitid: no child processes" and discarding the real exit status.
func TestStartOrphanReaper_DoesNotStartOffPID1(t *testing.T) {
	if started := startOrphanReaper(context.Background(), 4242); started {
		t.Fatal("reaper started off PID 1; it would race cmd.Wait() for the pool's own workers")
	}
}

func TestStartOrphanReaper_StartsOnPID1(t *testing.T) {
	if started := startOrphanReaper(t.Context(), 1); !started {
		t.Fatal("reaper did not start as PID 1; orphaned opencode children would leak")
	}
}

// The regression itself: with the gate in place, a child's exit status is still
// owned by whoever spawned it. Without the gate this is a race the reaper can
// win, leaving cmd.Wait() with ECHILD instead of the true exit code.
func TestStartOrphanReaper_LeavesChildExitStatusToTheSpawner(t *testing.T) {
	startOrphanReaper(t.Context(), 4242)

	cmd := exec.Command("sh", "-c", "exit 7")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start child: %v", err)
	}

	err := cmd.Wait()
	var exitErr *exec.ExitError
	if err == nil {
		t.Fatal("expected a non-zero exit, got success")
	}
	if !asExitError(err, &exitErr) {
		t.Fatalf("exit status was stolen before cmd.Wait() observed it: %v", err)
	}
	if got := exitErr.ExitCode(); got != 7 {
		t.Fatalf("expected exit code 7, got %d", got)
	}
}

func asExitError(err error, target **exec.ExitError) bool {
	if e, ok := err.(*exec.ExitError); ok {
		*target = e
		return true
	}
	return false
}

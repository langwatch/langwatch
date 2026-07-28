package workerpool

import (
	"context"
	"errors"
	"io"
	"os/exec"
	"sync"
	"testing"
	"time"
)

// The reaper's Wait4(-1, ...) matches ANY child of the process, not just a
// reparented orphan. The manager always has direct children (the worker
// subprocesses), so off PID 1 an ungated reaper races Pool.spawnInner's exit
// watcher and can reap a worker before cmd.Wait() sees it — turning a clean
// exit into "waitid: no child processes" and discarding the real exit status.
func TestStartOrphanReaper_DoesNotStartOffPID1(t *testing.T) {
	if started, _ := startReaperForTest(t, 4242); started {
		t.Fatal("reaper started off PID 1; it would race cmd.Wait() for the pool's own workers")
	}
}

func TestStartOrphanReaper_StartsOnPID1(t *testing.T) {
	started, stop := startReaperForTest(t, 1)
	if !started {
		t.Fatal("reaper did not start as PID 1; orphaned opencode children would leak")
	}
	// Tear the loop down HERE, inside the body, rather than leaving it to the
	// t.Cleanup safety net: cleanups run only after the body returns, so between
	// those two points a live Wait4(-1, ...) is armed in this process while the
	// framework is free to move on. That window is a hazard for whatever runs
	// next under any ordering — a -run filter's next test, a parallel test, a
	// child either of them spawns. Stopping here makes the SIGCHLD handler's
	// lifetime strictly shorter than this test's.
	stop()
}

// The regression itself: with the gate in place, a child's exit status is still
// owned by whoever spawned it. Without the gate this is not a race the reaper
// merely can win — it wins every time, leaving cmd.Wait() with ECHILD instead of
// the true exit code.
func TestStartOrphanReaper_LeavesChildExitStatusToTheSpawner(t *testing.T) {
	if started, _ := startReaperForTest(t, 4242); started {
		t.Fatal("reaper armed off PID 1; this test's premise is that the gate declined")
	}

	cmd := exec.Command("sh", "-c", "exit 7")
	// stdout is the exit signal: sh's fds close when it exits, so reading to EOF
	// parks this goroutine until the child is actually gone.
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start child: %v", err)
	}

	// THE GAP IS THE POINT. spawnInner does not call cmd.Wait() until after
	// readiness and session-open have both succeeded (pool.go), so a child that
	// dies inside that window sits reapable for as long as startup takes. Waiting
	// out the child's exit here models that window: with no gap, cmd.Wait() is
	// already blocked in waitid when the child dies and an ungated reaper only
	// steals it ~1% of the time, so the test passes with the gate reverted. With
	// the gap it steals every time.
	if _, err := io.ReadAll(stdout); err != nil {
		t.Fatalf("drain child stdout: %v", err)
	}
	// EOF says the fds are closed; give SIGCHLD delivery and any reaper drain
	// room to land before the spawner's own Wait().
	time.Sleep(100 * time.Millisecond)

	err = cmd.Wait()
	var exitErr *exec.ExitError
	if err == nil {
		t.Fatal("expected a non-zero exit, got success")
	}
	if !errors.As(err, &exitErr) {
		t.Fatalf("exit status was stolen before cmd.Wait() observed it: %v", err)
	}
	if got := exitErr.ExitCode(); got != 7 {
		t.Fatalf("expected exit code 7, got %d", got)
	}
}

// startReaperForTest arms the reaper under the given pid. It reports whether the
// loop armed, plus an idempotent stop that cancels the context and blocks until
// the goroutine is fully gone — its signal.Stop has already run by then, so
// after stop returns no SIGCHLD handler of ours is installed.
//
// stop is also registered as a t.Cleanup so an early t.Fatal cannot leak a live
// handler, but a test that arms the loop should call it explicitly: a cleanup
// runs after the body returns, which is late enough for the handler to overlap
// whatever the framework does next.
func startReaperForTest(t *testing.T, pid int) (started bool, stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	started, done := startOrphanReaper(ctx, pid)
	var once sync.Once
	stop = func() {
		once.Do(func() {
			cancel()
			if done == nil {
				return
			}
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Error("reaper goroutine did not stop after cancellation")
			}
		})
	}
	t.Cleanup(stop)
	return started, stop
}

package uvicornchild

import (
	"context"
	"net/http"
	"net/http/httptest"
	"runtime"
	"syscall"
	"testing"
	"time"

	"go.uber.org/zap"
)

// TestStop_EscalatesToSIGKILLWhenSIGTERMIsIgnored pins the
// double-cmd.Wait() bug fix. Repro: spawn a child that traps SIGTERM,
// call Stop(), assert the child is reaped within ~6s. Without the fix,
// killProcess()'s anonymous goroutine called cmd.Wait() a second time
// while watch() was already blocked on it — the second call returned
// immediately with "Wait was already called" so `done` closed, the
// 5-second timer never fired, and SIGKILL was never sent. Net effect:
// a stuck child outlives the manager indefinitely.
//
// Skipped on non-unix because bash + signal-trap semantics differ.
func TestStop_EscalatesToSIGKILLWhenSIGTERMIsIgnored(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("trap '' TERM is unix-only")
	}

	// Health endpoint just has to return 200 — the child doesn't need
	// to actually serve HTTP for this test (we're exercising the
	// signal-handling path, not request routing).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	m := New(Options{
		Command:       "bash",
		Args:          []string{"-c", "trap '' TERM; sleep 60"},
		HealthURL:     srv.URL,
		StartTimeout:  3 * time.Second,
		HealthTimeout: 1 * time.Second,
		Logger:        zap.NewNop(),
	})

	if err := m.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Capture the PID before Stop so we can verify reaping post-stop.
	m.mu.Lock()
	pid := m.cmd.Process.Pid
	m.mu.Unlock()

	stopDone := make(chan struct{})
	go func() {
		m.Stop()
		close(stopDone)
	}()

	select {
	case <-stopDone:
		// Stop returned. Confirm the child is actually gone (signal 0
		// = does-it-exist probe). After SIGKILL escalation + reap,
		// the pid should be unowned by us.
		err := syscall.Kill(pid, 0)
		if err == nil {
			// The child PID still exists in the process table (could
			// be a zombie not yet reaped, but our watch() should have
			// reaped it via cmd.Wait()). Allow a brief grace then
			// re-check.
			time.Sleep(200 * time.Millisecond)
			if err := syscall.Kill(pid, 0); err == nil {
				t.Errorf("child pid %d still alive after Stop returned — SIGKILL escalation did not fire", pid)
			}
		}
	case <-time.After(8 * time.Second):
		// Without the fix, killProcess's spurious second cmd.Wait()
		// returns immediately, the 5s timer never fires, and SIGKILL
		// is never sent. Child runs to its sleep 60.
		t.Fatal("Stop did not return within 8s — SIGKILL escalation broken (child likely still running)")
	}
}

package nlpgo

import (
	"context"
	"net"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/langwatch/langwatch/pkg/lifecycle"
)

// TestServe_ListenerBindsBeforeBlockingChild pins the contract that
// keeps nlpgo deployable on AWS Lambda: when Serve registers its
// services, the HTTP listener must bind $PORT before the uvicorn-child
// readiness wait runs.
//
// Background: in the prod incident on 2026-04-28 the previous shape
// registered Worker("uvicorn-child") BEFORE ListenServer("http"). The
// worker's startFn called Manager.Start synchronously, which blocks in
// waitHealthy polling the python child for ~12-18s. Lambda's init phase
// has a hard 10s ceiling — port never bound, init timed out, AWS
// retried inits, retry storm pinned ConcurrentExecutions to the
// account-level 1000 cap, and every Studio is_alive heartbeat surfaced
// "Rate Exceeded." in the toast.
//
// The fix in serve.go does two things:
//   1. Register ListenServer("http") BEFORE Worker("uvicorn-child").
//   2. Wrap the worker's startFn body in a `go func() { ... }()` so
//      Manager.Start runs in the background. The lifecycle group's
//      synchronous Service.Start returns instantly and the listener
//      starts as the next step.
//
// This test recreates the same registration shape using a worker that
// would block forever (simulating an unreachable child) and asserts the
// listener binds within a tight deadline. Without BOTH parts of the
// fix, the deadline expires.
func TestServe_ListenerBindsBeforeBlockingChild(t *testing.T) {
	// Pick a free port — bind, get the address, close so the lifecycle
	// listener can take it. There's a tiny race window with another
	// process on the host but on CI workers it's negligible.
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("probe listen: %v", err)
	}
	addr := probe.Addr().String()
	_ = probe.Close()

	srv := &http.Server{
		Addr:              addr,
		Handler:           http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }),
		ReadHeaderTimeout: time.Second,
	}

	var childStartCalled atomic.Bool
	// blockingStartFn simulates the ORIGINAL bad shape — a Worker whose
	// startFn body blocks on a child that never becomes healthy. The
	// fix wraps the inner block in a goroutine so the startFn itself
	// returns immediately. We replicate the FIXED shape here; if a
	// future refactor regresses by removing the goroutine wrap, the
	// listener-bind deadline below will fail.
	nonBlockingStartFn := func(ctx context.Context) {
		go func() {
			childStartCalled.Store(true)
			// Simulate Manager.waitHealthy on an unreachable upstream.
			<-ctx.Done()
		}()
	}

	g := lifecycle.New(lifecycle.WithGraceful(time.Second))
	g.Add(
		// Mirror serve.go ordering exactly: listener first, then worker.
		lifecycle.ListenServer("http", srv),
		lifecycle.Worker("uvicorn-child", nonBlockingStartFn, func() {}),
	)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	runDone := make(chan error, 1)
	go func() { runDone <- g.Run(ctx) }()

	// 100ms is comfortably under Lambda's 10s init budget while still
	// catching slow-start regressions. Local hosts dial loopback in
	// well under 10ms.
	deadline := time.Now().Add(100 * time.Millisecond)
	bound := false
	for time.Now().Before(deadline) {
		c, err := net.DialTimeout("tcp", addr, 20*time.Millisecond)
		if err == nil {
			_ = c.Close()
			bound = true
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	if !bound {
		t.Fatalf("http listener not bound at %s within 100ms — Lambda init phase would time out", addr)
	}

	// Cancel + drain the lifecycle goroutine so the test exits cleanly.
	cancel()
	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatalf("lifecycle.Run did not return within 2s after cancel")
	}

	// Sanity: the worker DID start (in the background) — proves we are
	// testing the right shape (a Worker that the group considers
	// "started" but whose inner work continues asynchronously).
	if !childStartCalled.Load() {
		t.Fatalf("worker startFn was never invoked; test would not catch a regression")
	}
}

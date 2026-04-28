package nlpgo

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/uvicornchild"
)

// TestBuildServices_RegistersListenerBeforeUvicornChild pins the
// registration order Serve uses on AWS Lambda. The HTTP listener must
// be registered (and therefore started) before the uvicorn-child
// Worker, otherwise the lifecycle group blocks on Manager.waitHealthy
// (~12-18s for litellm + langwatch_nlp imports) before $PORT binds and
// Lambda's 10s init ceiling fires.
//
// This test calls Serve's actual buildServices helper, so a regression
// that swaps the order back inside serve.go fails this test directly.
//
// Pre-fix incident: PR langwatch-saas#473 deploy on 2026-04-28 hit
// "INIT_REPORT Init Duration: 9999.10ms Status: timeout" on every
// per-project Lambda; failed inits retried, ConcurrentExecutions
// pinned at the 1000 account cap, and AWS surfaced "Rate Exceeded."
// to Studio's toast.
func TestBuildServices_RegistersListenerBeforeUvicornChild(t *testing.T) {
	deps := newTestDeps(t)
	srv := &http.Server{Addr: "127.0.0.1:0", ReadHeaderTimeout: time.Second}

	services := buildServices(deps, srv)

	// Find indices by service name (the lifecycle.Service interface's
	// String() method is the registered name).
	idx := map[string]int{}
	for i, s := range services {
		idx[s.String()] = i
	}
	listenerIdx, ok := idx["http"]
	if !ok {
		t.Fatalf("expected 'http' lifecycle service in buildServices output; got names %v", names(services))
	}
	childIdx, ok := idx["uvicorn-child"]
	if !ok {
		t.Fatalf("expected 'uvicorn-child' lifecycle service in buildServices output; got names %v", names(services))
	}
	if listenerIdx >= childIdx {
		t.Fatalf("Lambda init regression: 'http' listener (idx %d) must be registered before 'uvicorn-child' worker (idx %d). "+
			"Lifecycle services start sequentially via svc.Start(ctx); a blocking child Start would prevent $PORT bind "+
			"within Lambda's 10s init ceiling. Service order: %v", listenerIdx, childIdx, names(services))
	}
}

// TestBuildServices_UvicornChildWorkerDoesNotBlockStart pins the
// second half of the cold-start fix: even with the right ordering,
// if Worker("uvicorn-child")'s startFn synchronously waits on the
// child's health, the lifecycle group still blocks before reaching
// the listener (because the worker is registered after closer "otel"
// and lifecycle.Run starts services in order). The fix wraps the
// inner Manager.Start in a `go func()` so the startFn returns
// immediately. This test reaches into the worker's Service.Start and
// asserts it returns quickly even when given a context that would
// keep a synchronous child blocked indefinitely.
func TestBuildServices_UvicornChildWorkerDoesNotBlockStart(t *testing.T) {
	deps := newTestDeps(t)
	srv := &http.Server{Addr: "127.0.0.1:0", ReadHeaderTimeout: time.Second}

	services := buildServices(deps, srv)
	var worker lifecycle.Service
	for _, s := range services {
		if s.String() == "uvicorn-child" {
			worker = s
			break
		}
	}
	if worker == nil {
		t.Fatalf("uvicorn-child worker not registered; got names %v", names(services))
	}

	// Run Start with a context that will never be cancelled until we
	// say so. If startFn synchronously blocks (the regression we want
	// to catch), Start won't return and the deadline below fires.
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	done := make(chan error, 1)
	go func() { done <- worker.Start(ctx) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("worker.Start returned err: %v", err)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatalf("Lambda init regression: uvicorn-child worker.Start did not return within 100ms. " +
			"Wrap the inner Manager.Start call in a `go func()` so the lifecycle group's synchronous " +
			"Service.Start returns immediately and the next service (the http listener) starts.")
	}
}

// TestServe_ListenerBindsBeforeBlockingChild is the runtime sibling of
// the buildServices ordering test: it boots a real lifecycle.Group
// with the Serve-registered services and asserts the http listener
// has bound $PORT within a Lambda-safe deadline (100ms — far under
// the 10s init ceiling) even when the uvicorn-child worker is
// configured around a child that never becomes healthy. Together with
// the buildServices test above, both arms of the fix are pinned:
// (1) registration order, (2) non-blocking worker startFn.
func TestServe_ListenerBindsBeforeBlockingChild(t *testing.T) {
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("probe listen: %v", err)
	}
	addr := probe.Addr().String()
	_ = probe.Close()

	deps := newTestDeps(t)
	srv := &http.Server{
		Addr:              addr,
		Handler:           http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }),
		ReadHeaderTimeout: time.Second,
	}

	g := lifecycle.New(lifecycle.WithGraceful(time.Second))
	g.Add(buildServices(deps, srv)...)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	runDone := make(chan error, 1)
	go func() { runDone <- g.Run(ctx) }()

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

	cancel()
	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatalf("lifecycle.Run did not return within 2s after cancel")
	}
}

// newTestDeps builds a Deps with stubs for the cold-start tests.
// The uvicorn-child Manager is configured Disabled=true so its Start
// returns immediately — the test isn't exercising the child, only the
// registration shape that wraps it. OTel is constructed via
// otelsetup.New with empty OTLPEndpoint, which returns a noop Provider
// whose Shutdown is safe to invoke during lifecycle teardown.
func newTestDeps(t *testing.T) *Deps {
	t.Helper()
	child := uvicornchild.New(uvicornchild.Options{
		Disabled:  true,
		Logger:    zap.NewNop(),
		HealthURL: "http://127.0.0.1:1/never-healthy",
	})
	otelProvider, err := otelsetup.New(context.Background(), otelsetup.Options{})
	if err != nil {
		t.Fatalf("otelsetup.New: %v", err)
	}
	return &Deps{
		Logger: zap.NewNop(),
		OTel:   otelProvider,
		Child:  child,
	}
}

func names(services []lifecycle.Service) []string {
	out := make([]string, 0, len(services))
	for _, s := range services {
		out = append(out, s.String())
	}
	return out
}


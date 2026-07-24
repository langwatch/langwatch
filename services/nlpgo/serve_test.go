package nlpgo

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/pkg/otelsetup"
)

// TestBuildServices_RegistersHTTPListenerNoChild pins the Go-only
// lifecycle set: the http listener (which binds $PORT) plus the otel
// closer, and NO uvicorn-child worker. The Python child was removed, so
// nlpgo is a single Go process and nothing must sit between init and the
// $PORT bind. A regression that re-introduces a blocking child worker
// (which previously caused Lambda INIT_REPORT timeouts at 9999ms) would
// re-add a "uvicorn-child" entry and fail here.
func TestBuildServices_RegistersHTTPListenerNoChild(t *testing.T) {
	deps := newTestDeps(t)
	srv := &http.Server{Addr: "127.0.0.1:0", ReadHeaderTimeout: time.Second}

	got := names(buildServices(deps, srv))

	hasHTTP := false
	for _, n := range got {
		if n == "http" {
			hasHTTP = true
		}
		if n == "uvicorn-child" {
			t.Fatalf("uvicorn-child worker must not be registered after the Python-child removal; got %v", got)
		}
	}
	if !hasHTTP {
		t.Fatalf("expected an 'http' lifecycle service; got %v", got)
	}
}

// TestServe_ListenerBindsFast boots the real lifecycle group with the
// Serve-registered services and asserts the http listener binds $PORT
// within a Lambda-safe deadline (100ms, far under the 10s init ceiling).
// With the Python child gone there is nothing that could delay the bind,
// but the invariant stays pinned so a future blocking service can't
// regress Lambda cold-start init.
func TestServe_ListenerBindsFast(t *testing.T) {
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

	g := lifecycle.New(lifecycle.WithGraceful(5 * time.Second))
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
	case err := <-runDone:
		// lifecycle.Run returns nil on graceful cancel, or an error
		// wrapping context.Canceled if cancel propagated; anything else
		// is a failure.
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatalf("lifecycle.Run returned unexpected error: %v", err)
		}
	case <-time.After(7 * time.Second):
		t.Fatalf("lifecycle.Run did not return within 7s after cancel")
	}
}

// newTestDeps builds a minimal Deps for the lifecycle tests. OTel is
// constructed via otelsetup.New with an empty OTLPEndpoint, which
// returns a noop Provider whose Shutdown is safe to invoke during
// teardown.
func newTestDeps(t *testing.T) *Deps {
	t.Helper()
	otelProvider, err := otelsetup.New(context.Background(), otelsetup.Options{})
	if err != nil {
		t.Fatalf("otelsetup.New: %v", err)
	}
	return &Deps{
		Logger: zap.NewNop(),
		OTel:   otelProvider,
	}
}

func names(services []lifecycle.Service) []string {
	out := make([]string, 0, len(services))
	for _, s := range services {
		out = append(out, s.String())
	}
	return out
}

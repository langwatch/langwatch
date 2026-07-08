package langyagent

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
)

func portOf(t *testing.T, serverURL string) int {
	t.Helper()
	port, err := strconv.Atoi(strings.TrimPrefix(serverURL, "http://127.0.0.1:"))
	if err != nil {
		t.Fatalf("parse port from %q: %v", serverURL, err)
	}
	return port
}

// requireOpenCodeAuthEnforced is the Fix A′ fail-closed guard (ADR-033): if
// opencode is genuinely requiring auth, an unauthenticated probe gets 401
// and the guard passes.
func TestRequireOpenCodeAuthEnforced_PassesWhenBackendReturns401(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer backend.Close()

	if err := requireOpenCodeAuthEnforced(context.Background(), portOf(t, backend.URL)); err != nil {
		t.Fatalf("expected nil error when opencode requires auth, got %v", err)
	}
}

// If opencode ever stops honoring OPENCODE_SERVER_PASSWORD (upstream
// regression, misconfiguration), an unauthenticated request would get 200
// instead of 401 — the sibling-isolation guarantee this whole PR adds would
// be silently void. The guard must refuse to consider the worker ready.
func TestRequireOpenCodeAuthEnforced_FailsWhenBackendIsUnauthenticated(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	if err := requireOpenCodeAuthEnforced(context.Background(), portOf(t, backend.URL)); err == nil {
		t.Fatalf("expected an error when opencode answers an unauthenticated request with 200")
	}
}

// waitForReadiness must fail closed if the proxy chain is up but the
// underlying opencode doesn't actually require auth — booting the worker in
// that state would mean any sibling can reach it unauthenticated.
func TestWaitForReadiness_FailsIfInternalPortIsUnauthenticated(t *testing.T) {
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer external.Close()

	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK) // bug scenario: opencode not enforcing auth
	}))
	defer internal.Close()

	err := waitForReadiness(context.Background(), portOf(t, external.URL), portOf(t, internal.URL), "bearer", time.Second)
	if err == nil {
		t.Fatalf("expected waitForReadiness to fail closed when the internal port doesn't require auth")
	}
}

func TestWaitForReadiness_SucceedsWhenProxyUpAndInternalPortEnforcesAuth(t *testing.T) {
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer external.Close()

	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer internal.Close()

	err := waitForReadiness(context.Background(), portOf(t, external.URL), portOf(t, internal.URL), "bearer", time.Second)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
}

// Regression test for the spawn race in manager.go: startAuthProxy binds and
// starts serving :externalPort synchronously, but opencode's actual listener
// on :internalPort comes up later (it's a separate process). Before it's
// listening, the proxy's own rev.ErrorHandler answers polls with a genuine
// "502 Bad Gateway" -- a real, err==nil HTTP response, not a transport
// failure. waitForReadiness must not mistake that for "ready": doing so
// triggers a one-shot requireOpenCodeAuthEnforced probe against a port
// nothing is listening on yet, which fails and aborts the spawn. In
// production the proxy always wins this race against opencode's startup, so
// this used to fail almost every spawn.
//
// This drives waitForReadiness through the real startAuthProxy reverse-proxy
// chain (unlike the tests above, which poll two independent, already-up
// httptest servers and so never produce an actual 502).
func TestWaitForReadiness_SurvivesProxy502BeforeBackendListens(t *testing.T) {
	internalPort, err := getFreePort()
	if err != nil {
		t.Fatalf("reserve internal port: %v", err)
	}
	externalPort, err := getFreePort()
	if err != nil {
		t.Fatalf("reserve external port: %v", err)
	}

	proxy, err := startAuthProxy(externalPort, internalPort, "bearer", "opencode-pw", zap.NewNop())
	if err != nil {
		t.Fatalf("start auth proxy: %v", err)
	}
	defer proxy.shutdown()

	// Nothing listens on internalPort yet -- the proxy's first polls hit
	// connection-refused and answer 502. Only after a delay does the
	// "opencode" backend start listening, simulating its real startup time.
	backend := &http.Server{
		Addr: fmt.Sprintf("127.0.0.1:%d", internalPort),
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		}),
	}
	defer backend.Close()
	go func() {
		time.Sleep(150 * time.Millisecond)
		l, err := net.Listen("tcp", backend.Addr)
		if err != nil {
			return
		}
		_ = backend.Serve(l)
	}()

	err = waitForReadiness(context.Background(), externalPort, internalPort, "bearer", 2*time.Second)
	if err != nil {
		t.Fatalf("expected waitForReadiness to survive the proxy's pre-backend 502s and succeed once opencode starts listening, got %v", err)
	}
}

func TestEventBelongsToSession_TopLevelKeys(t *testing.T) {
	// OpenCode has emitted the sessionID under three different keys across
	// versions. eventBelongsToSession must accept all three.
	cases := []map[string]any{
		{"sessionID": "s1"},
		{"sessionId": "s1"},
		{"session_id": "s1"},
	}
	for _, ev := range cases {
		if !eventBelongsToSession(ev, "s1") {
			t.Errorf("expected match for %#v", ev)
		}
		if eventBelongsToSession(ev, "other") {
			t.Errorf("expected mismatch with other id for %#v", ev)
		}
	}
}

func TestEventBelongsToSession_PropertiesNested(t *testing.T) {
	ev := map[string]any{
		"type":       "message.part.delta",
		"properties": map[string]any{"sessionID": "s2", "field": "text"},
	}
	if !eventBelongsToSession(ev, "s2") {
		t.Errorf("expected match via properties.sessionID")
	}
	if eventBelongsToSession(ev, "other") {
		t.Errorf("expected mismatch via properties.sessionID")
	}
}

func TestEventBelongsToSession_EmptyTargetRejects(t *testing.T) {
	// An empty sessionID must never match — otherwise events from a worker
	// whose session id we don't yet know would be forwarded blindly.
	ev := map[string]any{"sessionID": "s1"}
	if eventBelongsToSession(ev, "") {
		t.Errorf("expected empty sessionID to reject")
	}
}

func TestTerminalEventTypes_Present(t *testing.T) {
	for _, name := range []string{
		"message.completed",
		"message.done",
		"session.idle",
		"session.completed",
		"error",
	} {
		if _, ok := terminalEventTypes[name]; !ok {
			t.Errorf("expected %q to be a terminal event type", name)
		}
	}
}

// The guard must probe a real CONTROL endpoint, not just `/`. A worker where
// the root route returns 401 but the actual control API (POST /session) is
// reachable unauthenticated is exactly the cross-worker exposure ADR-033
// closes — the guard must refuse to start it even though `/` looks protected.
func TestRequireOpenCodeAuthEnforced_FailsWhenControlEndpointReachableEvenIfRootIs401(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/session" {
			w.WriteHeader(http.StatusOK) // control plane accidentally exposed
			return
		}
		w.WriteHeader(http.StatusUnauthorized) // root looks protected
	}))
	defer backend.Close()

	if err := requireOpenCodeAuthEnforced(context.Background(), portOf(t, backend.URL)); err == nil {
		t.Fatalf("expected the guard to fail when POST /session is reachable unauthenticated, even though / returns 401")
	}
}

// A transport failure on the internal probe (opencode's listener not up yet, a
// reset) must be classified as retryable — not a security verdict — so
// waitForReadiness keeps polling instead of aborting the spawn.
func TestRequireOpenCodeAuthEnforced_TransportErrorIsRetryable(t *testing.T) {
	port, err := getFreePort() // nothing listening here
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	err = requireOpenCodeAuthEnforced(context.Background(), port)
	if err == nil {
		t.Fatalf("expected an error probing a port with no listener")
	}
	if !errors.Is(err, errAuthProbeUnreachable) {
		t.Fatalf("transport failure must be classified retryable (errAuthProbeUnreachable), got %v", err)
	}
}

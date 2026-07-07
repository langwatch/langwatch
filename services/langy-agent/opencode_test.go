package langyagent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
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

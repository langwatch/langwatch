package workerpool

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
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
// opencode is genuinely requiring auth, an unauthenticated probe gets 401 and
// the guard passes.
func TestRequireOpenCodeAuthEnforced_PassesWhenBackendReturns401(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer backend.Close()

	if err := requireOpenCodeAuthEnforced(context.Background(), portOf(t, backend.URL)); err != nil {
		t.Fatalf("expected nil error when opencode requires auth, got %v", err)
	}
}

// If opencode ever stops honoring OPENCODE_SERVER_PASSWORD, an unauthenticated
// request would get 200 instead of 401 — the sibling-isolation guarantee would
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

// waitForReadiness must fail closed if the proxy chain is up but the underlying
// opencode doesn't actually require auth — booting the worker in that state
// would mean any sibling can reach it unauthenticated.
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

// Regression for the spawn race: startAuthProxy binds and serves synchronously,
// but opencode's listener on internalPort comes up later. Before it's
// listening, the proxy's ErrorHandler answers polls with a genuine 502 — a
// real, err==nil HTTP response, not a transport failure. waitForReadiness must
// not mistake that for "ready": doing so triggers a one-shot
// requireOpenCodeAuthEnforced probe against a port nothing is listening on yet.
// In production the proxy always wins this race against opencode's startup.
func TestWaitForReadiness_SurvivesProxy502BeforeBackendListens(t *testing.T) {
	internalPort, err := getFreePort()
	if err != nil {
		t.Fatalf("reserve internal port: %v", err)
	}
	externalPort, err := getFreePort()
	if err != nil {
		t.Fatalf("reserve external port: %v", err)
	}

	proxy, err := startAuthProxy(context.Background(), externalPort, internalPort, "bearer", "opencode-pw")
	if err != nil {
		t.Fatalf("start auth proxy: %v", err)
	}
	defer proxy.shutdown()

	// Nothing listens on internalPort yet — the proxy's first polls hit
	// connection-refused and answer 502. Only after a delay does the "opencode"
	// backend start listening, simulating its real startup time.
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

// decodeSSE mirrors the streaming decode path: unmarshal a raw /event payload
// into the typed sseEvent used for routing + terminal detection.
func decodeSSE(t *testing.T, payload string) *sseEvent {
	t.Helper()
	var ev sseEvent
	if err := json.Unmarshal([]byte(payload), &ev); err != nil {
		t.Fatalf("decode %q: %v", payload, err)
	}
	return &ev
}

// OpenCode has emitted the session id under three top-level keys and two nested
// under "properties" across versions. The typed decode + eventBelongsToSession
// must route ALL of them (and only to the matching session).
func TestEventBelongsToSession_DecodesEverySessionIDVariant(t *testing.T) {
	cases := []struct {
		name    string
		payload string
	}{
		{"top-level sessionID", `{"type":"message.part.delta","sessionID":"s1"}`},
		{"top-level sessionId", `{"type":"message.part.delta","sessionId":"s1"}`},
		{"top-level session_id", `{"type":"message.part.delta","session_id":"s1"}`},
		{"properties.sessionID", `{"type":"message.part.delta","properties":{"sessionID":"s1"}}`},
		{"properties.sessionId", `{"type":"message.part.delta","properties":{"sessionId":"s1"}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ev := decodeSSE(t, tc.payload)
			if !eventBelongsToSession(ev, "s1") {
				t.Errorf("expected %s to route to s1", tc.name)
			}
			if eventBelongsToSession(ev, "other") {
				t.Errorf("expected %s NOT to route to a different session", tc.name)
			}
		})
	}
}

func TestEventBelongsToSession_EmptyTargetRejects(t *testing.T) {
	// An empty sessionID must never match — otherwise events from a worker whose
	// session id we don't yet know would be forwarded blindly.
	ev := decodeSSE(t, `{"sessionID":"s1"}`)
	if eventBelongsToSession(ev, "") {
		t.Errorf("expected empty sessionID to reject")
	}
}

func TestEventBelongsToSession_UnknownFieldsIgnored(t *testing.T) {
	// The typed decode must skip the bulk of an opencode event (unknown fields)
	// without error and still route by session + expose the type.
	ev := decodeSSE(t, `{"type":"message.part.delta","sessionID":"s2","part":{"text":"hi"},"extra":123}`)
	if !eventBelongsToSession(ev, "s2") {
		t.Errorf("unknown fields must be ignored and the event still routed")
	}
	if ev.Type != "message.part.delta" {
		t.Errorf("Type = %q, want message.part.delta", ev.Type)
	}
}

// Terminal detection runs off the decoded Type — the decode must surface it for
// each terminal variant so the stream closes (and NOT for a delta).
func TestSSEDecode_TerminalTypeDetected(t *testing.T) {
	for _, typ := range []string{"message.completed", "message.done", "session.idle", "session.completed", "error"} {
		ev := decodeSSE(t, `{"type":"`+typ+`","sessionID":"s1"}`)
		if _, terminal := terminalEventTypes[ev.Type]; !terminal {
			t.Errorf("decoded type %q should be terminal", typ)
		}
	}
	ev := decodeSSE(t, `{"type":"message.part.delta","sessionID":"s1"}`)
	if _, terminal := terminalEventTypes[ev.Type]; terminal {
		t.Errorf("message.part.delta must NOT be terminal")
	}
}

// streamSessionEvents must forward OUR session's events verbatim as ndjson,
// filter a sibling session's events (the isolation guarantee on the read side),
// and stop at the terminal event.
func TestStreamSessionEvents_ForwardsOwnSessionAndFiltersSibling(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/event" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		fl, _ := w.(http.Flusher)
		emit := func(s string) {
			fmt.Fprintf(w, "data: %s\n", s)
			if fl != nil {
				fl.Flush()
			}
		}
		emit(`{"type":"message.part.delta","sessionID":"mine","text":"hello"}`)
		emit(`{"type":"message.part.delta","sessionID":"sibling","text":"leak?"}`)
		emit(`{"type":"message.completed","sessionID":"mine"}`)
	}))
	defer srv.Close()

	var buf bytes.Buffer
	if err := streamSessionEvents(context.Background(), srv.URL, "bearer", "mine", &buf, nil); err != nil {
		t.Fatalf("streamSessionEvents: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, `"sessionID":"mine"`) || !strings.Contains(out, "hello") {
		t.Errorf("our session's event should be forwarded verbatim, got %q", out)
	}
	if strings.Contains(out, "sibling") || strings.Contains(out, "leak?") {
		t.Errorf("a sibling session's event must NOT be forwarded, got %q", out)
	}
	if !strings.Contains(out, "message.completed") {
		t.Errorf("terminal event should be forwarded, got %q", out)
	}
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != 2 {
		t.Errorf("expected exactly 2 ndjson lines (our delta + terminal), got %d: %q", len(lines), out)
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

// The guard must probe a real CONTROL endpoint, not just `/`. A worker where the
// root route returns 401 but the actual control API (POST /session) is reachable
// unauthenticated is exactly the cross-worker exposure ADR-033 closes — the
// guard must refuse to start it even though `/` looks protected.
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

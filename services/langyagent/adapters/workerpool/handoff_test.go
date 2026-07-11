package workerpool

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// ADR-048: `handoff` must be a terminal event type so streamSessionEvents
// forwards the frame and returns cleanly, ending the turn.
func TestTerminalEventTypes_IncludesHandoff(t *testing.T) {
	if _, ok := terminalEventTypes["handoff"]; !ok {
		t.Fatalf("expected \"handoff\" to be a terminal event type (ADR-048)")
	}
}

// notifyShutdownImminent POSTs the session-scoped shutdown notice with the
// absolute deadline (unix millis) opencode must checkpoint before.
func TestNotifyShutdownImminent_PostsDeadline(t *testing.T) {
	var gotPath, gotAuth string
	var gotBody struct {
		Deadline int64 `json:"deadline"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	deadline := time.UnixMilli(1_752_000_000_000)
	err := notifyShutdownImminent(context.Background(), srv.URL, "bearer-abc", "sess-1", deadline)
	if err != nil {
		t.Fatalf("notifyShutdownImminent: %v", err)
	}
	if gotPath != "/session/sess-1/shutdown_imminent" {
		t.Errorf("path = %q, want /session/sess-1/shutdown_imminent", gotPath)
	}
	if gotAuth != "Bearer bearer-abc" {
		t.Errorf("auth = %q, want Bearer bearer-abc", gotAuth)
	}
	if gotBody.Deadline != deadline.UnixMilli() {
		t.Errorf("deadline = %d, want %d", gotBody.Deadline, deadline.UnixMilli())
	}
}

func TestNotifyShutdownImminent_ErrorOnServerFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	if err := notifyShutdownImminent(context.Background(), srv.URL, "b", "sess-1", time.Now()); err == nil {
		t.Fatalf("expected an error when opencode answers 500 to shutdown_imminent")
	}
}

// The token in a handoff frame is opaque to the manager; extractHandoffToken
// only asserts the frame shape (bare and nested) for bookkeeping/tests.
func TestExtractHandoffToken(t *testing.T) {
	bare := map[string]any{"type": "handoff", "token": "opaque-1"}
	if tok, ok := extractHandoffToken(bare); !ok || tok != "opaque-1" {
		t.Errorf("bare: got (%q,%v), want (opaque-1,true)", tok, ok)
	}
	nested := map[string]any{"type": "handoff", "properties": map[string]any{"token": "opaque-2"}}
	if tok, ok := extractHandoffToken(nested); !ok || tok != "opaque-2" {
		t.Errorf("nested: got (%q,%v), want (opaque-2,true)", tok, ok)
	}
	notHandoff := map[string]any{"type": "message.done"}
	if _, ok := extractHandoffToken(notHandoff); ok {
		t.Errorf("a non-handoff event must not report a handoff token")
	}
}

// A resume token (ADR-048) rides the prompt_async body so opencode restores
// "done so far" instead of cold-starting.
func TestPostMessage_IncludesResumeToken(t *testing.T) {
	var body struct {
		ResumeToken string `json:"resumeToken"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	err := postMessage(context.Background(), srv.URL, "b", "sess-1", "sys", "hi", "resume-token-xyz")
	if err != nil {
		t.Fatalf("postMessage: %v", err)
	}
	if body.ResumeToken != "resume-token-xyz" {
		t.Errorf("resumeToken = %q, want resume-token-xyz", body.ResumeToken)
	}
}

// A cold start omits the resume token entirely (omitempty), so opencode sees no
// checkpoint field at all.
func TestPostMessage_OmitsResumeTokenWhenEmpty(t *testing.T) {
	var raw map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&raw)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	if err := postMessage(context.Background(), srv.URL, "b", "sess-1", "sys", "hi", ""); err != nil {
		t.Fatalf("postMessage: %v", err)
	}
	if _, present := raw["resumeToken"]; present {
		t.Errorf("resumeToken must be omitted on a cold start, got %v", raw["resumeToken"])
	}
}

// The in-flight turn's event tail must terminate on a `handoff` frame and
// forward it to the sink, so the control plane can persist the token off the
// still-open /chat response (ADR-048).
func TestStreamSessionEvents_HandoffFrameTerminatesAndForwards(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fl, ok := w.(http.Flusher)
		if !ok {
			t.Errorf("test server needs a Flusher")
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, "data: {\"type\":\"message.part.delta\",\"sessionID\":\"sess-1\",\"properties\":{\"field\":\"text\",\"delta\":\"partial\"}}\n\n")
		fl.Flush()
		io.WriteString(w, "data: {\"type\":\"handoff\",\"sessionID\":\"sess-1\",\"token\":\"opaque-resume\"}\n\n")
		fl.Flush()
		// Hold the connection open; streamSessionEvents must return on the
		// terminal handoff frame without waiting for us to close.
		time.Sleep(500 * time.Millisecond)
	}))
	defer srv.Close()

	var out bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- streamSessionEvents(context.Background(), srv.URL, "b", "sess-1", &out, func() {})
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("streamSessionEvents returned error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("streamSessionEvents did not return on the terminal handoff frame")
	}

	got := out.String()
	if !strings.Contains(got, "\"type\":\"handoff\"") || !strings.Contains(got, "opaque-resume") {
		t.Errorf("sink missing forwarded handoff frame; got: %q", got)
	}
	if !strings.Contains(got, "partial") {
		t.Errorf("sink missing the pre-handoff delta; got: %q", got)
	}
}

// newHandoffWorker builds a Worker pointing at a test opencode control server,
// claimed (in-flight), for the ShutdownHandoff pool tests. Same-package access
// to the unexported fields keeps this out of the real spawn path.
func newHandoffWorker(conversationID, sessionID, baseURL string) *Worker {
	w := &Worker{
		conversationID:    conversationID,
		baseURL:           baseURL,
		bearerToken:       "b",
		openCodeSessionID: sessionID,
	}
	w.Claim() // mark in-flight
	return w
}

// ShutdownHandoff notifies every live worker and returns as soon as the
// in-flight turns quiesce (their StreamEvents saw the terminal handoff frame and
// Released), well before the deadline.
func TestPool_ShutdownHandoff_NotifiesAndWaitsForQuiesce(t *testing.T) {
	var mu sync.Mutex
	notified := map[string]bool{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/shutdown_imminent") {
			mu.Lock()
			notified[r.URL.Path] = true
			mu.Unlock()
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	p := newTestPool(4)
	w1 := newHandoffWorker("conv-1", "sess-1", srv.URL)
	w2 := newHandoffWorker("conv-2", "sess-2", srv.URL)
	p.workers["conv-1"] = w1
	p.workers["conv-2"] = w2

	// Simulate the in-flight turns finishing shortly after the notice.
	go func() {
		time.Sleep(120 * time.Millisecond)
		w1.Release()
		w2.Release()
	}()

	start := time.Now()
	p.ShutdownHandoff(context.Background(), time.Now().Add(3*time.Second))
	elapsed := time.Since(start)

	if elapsed >= 3*time.Second {
		t.Errorf("ShutdownHandoff waited for the full deadline (%s) instead of returning on quiesce", elapsed)
	}
	mu.Lock()
	defer mu.Unlock()
	if !notified["/session/sess-1/shutdown_imminent"] || !notified["/session/sess-2/shutdown_imminent"] {
		t.Errorf("expected every live worker to be notified, got %v", notified)
	}
}

// A turn that never quiesces caps at the deadline and falls back to cold restart
// (the honest ADR-048 limit) — it must not block past the deadline.
func TestPool_ShutdownHandoff_CapsAtDeadline(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	p := newTestPool(4)
	// Claimed and never released — the turn does not quiesce.
	p.workers["conv-stuck"] = newHandoffWorker("conv-stuck", "sess-stuck", srv.URL)

	start := time.Now()
	p.ShutdownHandoff(context.Background(), time.Now().Add(250*time.Millisecond))
	elapsed := time.Since(start)

	if elapsed > 2*time.Second {
		t.Errorf("ShutdownHandoff blocked past the deadline: %s", elapsed)
	}
	if elapsed < 200*time.Millisecond {
		t.Errorf("ShutdownHandoff returned before the deadline: %s", elapsed)
	}
}

// No live workers ⇒ a no-op that returns immediately.
func TestPool_ShutdownHandoff_NoWorkersIsNoop(t *testing.T) {
	p := newTestPool(4)
	start := time.Now()
	p.ShutdownHandoff(context.Background(), time.Now().Add(5*time.Second))
	if time.Since(start) > 500*time.Millisecond {
		t.Errorf("ShutdownHandoff with no workers should return immediately")
	}
}

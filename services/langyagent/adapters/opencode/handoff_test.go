package opencode

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// ADR-048: `handoff` must be a terminal event type so StreamSession
// forwards the frame and returns cleanly, ending the turn.
func TestTerminalEventTypes_IncludesHandoff(t *testing.T) {
	if _, ok := terminalEventTypes["handoff"]; !ok {
		t.Fatalf("expected \"handoff\" to be a terminal event type (ADR-048)")
	}
}

// NotifyShutdownImminent POSTs the session-scoped shutdown notice with the
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
	err := NotifyShutdownImminent(context.Background(), srv.URL, "bearer-abc", "sess-1", deadline)
	if err != nil {
		t.Fatalf("NotifyShutdownImminent: %v", err)
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

	if err := NotifyShutdownImminent(context.Background(), srv.URL, "b", "sess-1", time.Now()); err == nil {
		t.Fatalf("expected an error when opencode answers 500 to shutdown_imminent")
	}
}

// The token in a handoff frame is opaque to the manager; ExtractHandoffToken
// only asserts the frame shape (bare and nested) for bookkeeping/tests.
func TestExtractHandoffToken(t *testing.T) {
	bare := map[string]any{"type": "handoff", "token": "opaque-1"}
	if tok, ok := ExtractHandoffToken(bare); !ok || tok != "opaque-1" {
		t.Errorf("bare: got (%q,%v), want (opaque-1,true)", tok, ok)
	}
	nested := map[string]any{"type": "handoff", "properties": map[string]any{"token": "opaque-2"}}
	if tok, ok := ExtractHandoffToken(nested); !ok || tok != "opaque-2" {
		t.Errorf("nested: got (%q,%v), want (opaque-2,true)", tok, ok)
	}
	notHandoff := map[string]any{"type": "message.done"}
	if _, ok := ExtractHandoffToken(notHandoff); ok {
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

	err := PostMessage(context.Background(), srv.URL, "b", "sess-1", "sys", "hi", "resume-token-xyz")
	if err != nil {
		t.Fatalf("PostMessage: %v", err)
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

	if err := PostMessage(context.Background(), srv.URL, "b", "sess-1", "sys", "hi", ""); err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	if _, present := raw["resumeToken"]; present {
		t.Errorf("resumeToken must be omitted on a cold start, got %v", raw["resumeToken"])
	}
}

// The in-flight turn's event tail must terminate on a `handoff` frame, emit a
// terminal frames.Handoff carrying the opaque resume token (so the relay can
// persist it), and signal ErrTurnHandedOff so app.Chat skips its own terminal
// frame but still finalizes (ADR-048).
func TestStreamSession_HandoffFrameTerminatesAndEmits(t *testing.T) {
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
		// Hold the connection open; StreamSession must return on the terminal
		// handoff frame without waiting for us to close.
		time.Sleep(500 * time.Millisecond)
	}))
	defer srv.Close()

	var mu sync.Mutex
	var emitted []string
	done := make(chan error, 1)
	go func() {
		done <- StreamSession(context.Background(), srv.URL, "b", "sess-1", func(f frames.Frame) error {
			mu.Lock()
			emitted = append(emitted, f.JSON())
			mu.Unlock()
			return nil
		})
	}()

	select {
	case err := <-done:
		if !errors.Is(err, domain.ErrTurnHandedOff) {
			t.Fatalf("StreamSession must signal ErrTurnHandedOff on a handoff terminal, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("StreamSession did not return on the terminal handoff frame")
	}

	mu.Lock()
	joined := strings.Join(emitted, "")
	mu.Unlock()
	if !strings.Contains(joined, `"type":"handoff"`) || !strings.Contains(joined, "opaque-resume") {
		t.Errorf("missing emitted handoff frame; got: %q", joined)
	}
	if !strings.Contains(joined, "partial") {
		t.Errorf("missing the pre-handoff delta; got: %q", joined)
	}
}

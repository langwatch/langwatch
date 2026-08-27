package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// silentExecutor is a fake app.WorkflowExecutor whose stream never emits
// anything and stays open until the handler cancels it — a run whose node
// is stuck with no progress to report. A fake rather than a mock: the
// assertion is on the frames that reach the wire, not on a call sequence.
type silentExecutor struct{}

func (e *silentExecutor) Execute(context.Context, app.WorkflowRequest) (*app.WorkflowResult, error) {
	return &app.WorkflowResult{Status: "success"}, nil
}

func (e *silentExecutor) ExecuteStream(ctx context.Context, _ app.WorkflowRequest, _ app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
	ch := make(chan app.WorkflowStreamEvent)
	go func() {
		<-ctx.Done()
		close(ch)
	}()
	return ch, nil
}

// serveExecuteStream drives the real router in a goroutine and reports
// whether the handler returned before `within`. A stream that never ends is
// the bug under test, so the deadline is the assertion, not a convenience.
func serveExecuteStream(t *testing.T, deps RouterDeps, within time.Duration) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/go/studio/execute", strings.NewReader(heartbeatProbeBody))
	done := make(chan struct{})
	go func() {
		defer close(done)
		NewRouter(deps).ServeHTTP(rec, r)
	}()
	select {
	case <-done:
	case <-time.After(within):
		t.Fatalf("handler still draining after %v; the idle stream was never closed", within)
	}
	return rec
}

// sseFrames parses the recorded body the way Studio's post-event parser
// does: every `data: ` line is one JSON frame.
func sseFrames(t *testing.T, body string) []map[string]any {
	t.Helper()
	var frames []map[string]any
	for _, line := range strings.Split(body, "\n") {
		raw, ok := strings.CutPrefix(line, "data: ")
		if !ok {
			continue
		}
		var frame map[string]any
		if err := json.Unmarshal([]byte(raw), &frame); err != nil {
			t.Fatalf("unparseable SSE frame %q: %v", raw, err)
		}
		frames = append(frames, frame)
	}
	return frames
}

// TestExecuteStreamHandler_IdleStreamTimesOutAndCloses pins the operator
// knob NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS to observable behavior: a
// stream that goes silent past the budget is closed, and the client is told
// why instead of being left holding an open connection forever.
// @scenario "idle stream times out and closes"
func TestExecuteStreamHandler_IdleStreamTimesOutAndCloses(t *testing.T) {
	rec := serveExecuteStream(t, RouterDeps{
		App:               app.New(app.WithWorkflowExecutor(&silentExecutor{})),
		StreamIdleTimeout: 50 * time.Millisecond,
	}, 2*time.Second)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (SSE headers commit before the drain loop); body=%s", rec.Code, rec.Body.String())
	}
	frames := sseFrames(t, rec.Body.String())
	if len(frames) == 0 {
		t.Fatalf("no SSE frames written; body=%q", rec.Body.String())
	}
	last := frames[len(frames)-1]
	if last["type"] != "error" {
		t.Fatalf("last frame type = %v, want \"error\"; frames=%v", last["type"], frames)
	}
	payload, _ := last["payload"].(map[string]any)
	msg, _ := payload["message"].(string)
	if !strings.Contains(msg, "idle_timeout") {
		t.Errorf("error payload.message = %q; want it to name %q", msg, "idle_timeout")
	}
}

// TestExecuteStreamHandler_EventsKeepTheStreamAlive pins the other half: the
// idle budget is a silence budget, not a wall clock. A run that keeps
// reporting progress must never be cut off, however long it takes.
func TestExecuteStreamHandler_EventsKeepTheStreamAlive(t *testing.T) {
	rec := serveExecuteStream(t, RouterDeps{
		App:               app.New(app.WithWorkflowExecutor(&tickingExecutor{ticks: 6, every: 20 * time.Millisecond})),
		StreamIdleTimeout: 60 * time.Millisecond,
	}, 5*time.Second)

	frames := sseFrames(t, rec.Body.String())
	if len(frames) != 6 {
		t.Fatalf("got %d frames, want 6 (no frame may be replaced by an idle error); frames=%v", len(frames), frames)
	}
	for i, frame := range frames {
		if frame["type"] != "execution_state_change" {
			t.Errorf("frame %d type = %v, want execution_state_change", i, frame["type"])
		}
	}
}

// tickingExecutor emits `ticks` events spaced by `every`, each gap shorter
// than the idle budget under test, then closes the stream.
type tickingExecutor struct {
	ticks int
	every time.Duration
}

func (e *tickingExecutor) Execute(context.Context, app.WorkflowRequest) (*app.WorkflowResult, error) {
	return &app.WorkflowResult{Status: "success"}, nil
}

func (e *tickingExecutor) ExecuteStream(ctx context.Context, _ app.WorkflowRequest, _ app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
	ch := make(chan app.WorkflowStreamEvent)
	go func() {
		defer close(ch)
		for i := 0; i < e.ticks; i++ {
			select {
			case <-ctx.Done():
				return
			case <-time.After(e.every):
			}
			select {
			case <-ctx.Done():
				return
			case ch <- app.WorkflowStreamEvent{Type: "execution_state_change"}:
			}
		}
	}()
	return ch, nil
}

// TestStreamIdleTimeout_NonPositiveConfigFallsBackToTheDefault guards the
// misconfiguration edge at the point of use. Zero must mean "the adapter
// decides", never "cut every stream off immediately".
func TestStreamIdleTimeout_NonPositiveConfigFallsBackToTheDefault(t *testing.T) {
	for name, configured := range map[string]time.Duration{
		"unset":    0,
		"negative": -30 * time.Second,
	} {
		t.Run(name, func(t *testing.T) {
			if got := streamIdleTimeout(configured); got != DefaultStreamIdleTimeout {
				t.Errorf("streamIdleTimeout(%v) = %v; want %v", configured, got, DefaultStreamIdleTimeout)
			}
		})
	}
}

// TestStreamIdleTimeout_ConfiguredValueWins pins that an operator who
// shortens the budget actually gets the shorter budget.
func TestStreamIdleTimeout_ConfiguredValueWins(t *testing.T) {
	if want := 90 * time.Second; streamIdleTimeout(want) != want {
		t.Errorf("streamIdleTimeout(%v) = %v; want %v", want, streamIdleTimeout(want), want)
	}
}

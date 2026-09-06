package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// heartbeatRecordingExecutor is a fake app.WorkflowExecutor that records
// the stream options the handler built and immediately ends the stream.
// A fake rather than a mock: the assertion is on the value that reached
// the engine port, not on the call sequence.
type heartbeatRecordingExecutor struct {
	gotHeartbeat time.Duration
}

func (e *heartbeatRecordingExecutor) Execute(context.Context, app.WorkflowRequest) (*app.WorkflowResult, error) {
	return &app.WorkflowResult{Status: "success"}, nil
}

func (e *heartbeatRecordingExecutor) ExecuteStream(_ context.Context, _ app.WorkflowRequest, opts app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
	e.gotHeartbeat = opts.Heartbeat
	ch := make(chan app.WorkflowStreamEvent)
	close(ch)
	return ch, nil
}

const heartbeatProbeBody = `{
	"type": "execute_flow",
	"payload": {
		"trace_id": "abc",
		"workflow": {"workflow_id": "wf", "api_key": "k", "spec_version": "1.3"}
	}
}`

// postExecuteStream drives the real router so the assertion covers the
// whole RouterDeps → handler → engine-port path, not just the helper.
func postExecuteStream(t *testing.T, deps RouterDeps, header string) {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/go/studio/execute", strings.NewReader(heartbeatProbeBody))
	if header != "" {
		r.Header.Set("X-LangWatch-NLPGO-Heartbeat-MS", header)
	}
	rec := httptest.NewRecorder()
	NewRouter(deps).ServeHTTP(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
}

// TestExecuteStreamHandler_UsesTheConfiguredHeartbeat pins the second
// half of the wiring: the cadence carried on RouterDeps must be the one
// handed to the engine, replacing the 15s the handler used to hardcode.
func TestExecuteStreamHandler_UsesTheConfiguredHeartbeat(t *testing.T) {
	exec := &heartbeatRecordingExecutor{}
	postExecuteStream(t, RouterDeps{
		App:             app.New(app.WithWorkflowExecutor(exec)),
		StreamHeartbeat: 30 * time.Second,
	}, "")

	if want := 30 * time.Second; exec.gotHeartbeat != want {
		t.Errorf("engine heartbeat = %v; want %v (RouterDeps.StreamHeartbeat)", exec.gotHeartbeat, want)
	}
}

// TestExecuteStreamHandler_UnsetHeartbeatFallsBackToTheDefault pins that
// an unconfigured router still emits is_alive_response at the contract
// cadence, rather than handing the engine a zero that disables the
// heartbeat goroutine outright.
func TestExecuteStreamHandler_UnsetHeartbeatFallsBackToTheDefault(t *testing.T) {
	exec := &heartbeatRecordingExecutor{}
	postExecuteStream(t, RouterDeps{App: app.New(app.WithWorkflowExecutor(exec))}, "")

	if exec.gotHeartbeat != DefaultStreamHeartbeat {
		t.Errorf("engine heartbeat = %v; want %v", exec.gotHeartbeat, DefaultStreamHeartbeat)
	}
}

// TestExecuteStreamHandler_HeaderStillOverridesTheConfiguredHeartbeat
// keeps the per-request test hook working after the config knob landed:
// the integration suite drives a 250ms cadence through this header.
func TestExecuteStreamHandler_HeaderStillOverridesTheConfiguredHeartbeat(t *testing.T) {
	exec := &heartbeatRecordingExecutor{}
	postExecuteStream(t, RouterDeps{
		App:             app.New(app.WithWorkflowExecutor(exec)),
		StreamHeartbeat: 30 * time.Second,
	}, "250")

	if want := 250 * time.Millisecond; exec.gotHeartbeat != want {
		t.Errorf("engine heartbeat = %v; want %v (header must win)", exec.gotHeartbeat, want)
	}
}

// TestStreamHeartbeat_NegativeConfigDoesNotReachTheEngine is the edge
// the config helper guards, asserted at the point of use: a negative
// duration must never be handed on, because the engine starts no
// heartbeat goroutine for one.
func TestStreamHeartbeat_NegativeConfigDoesNotReachTheEngine(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/", nil)

	if got := streamHeartbeat(r, -30*time.Second); got != DefaultStreamHeartbeat {
		t.Errorf("streamHeartbeat(-30s) = %v; want %v", got, DefaultStreamHeartbeat)
	}
}

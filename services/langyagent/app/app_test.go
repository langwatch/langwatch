package app

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// --- fakes ---

type fakePool struct {
	acquireErr error
	worker     Worker
	killed     []string
	liveWorker bool
}

func (f *fakePool) HasLiveWorker(string, domain.CredentialSignature) bool { return f.liveWorker }

func (f *fakePool) Acquire(_ context.Context, _ string, _ domain.Credentials) (Worker, error) {
	if f.acquireErr != nil {
		return nil, f.acquireErr
	}
	return f.worker, nil
}
func (f *fakePool) Status() (int, int)                         { return 0, 0 }
func (f *fakePool) KillSessionVanished(id string)              { f.killed = append(f.killed, id) }
func (f *fakePool) StartReaper()                               {}
func (f *fakePool) ShutdownHandoff(context.Context, time.Time) {}
func (f *fakePool) Shutdown()                                  {}

type fakeWorker struct {
	claimOK          bool
	claimed          int
	released         int
	postErr          error
	gotResumeToken   string
	streamErr        error
	streamWrites     bool // emit one delta frame on the stream (happy path)
	blockUntilCancel bool // wait for ctx cancellation before returning (post-error path)
}

func (w *fakeWorker) ClaimTurn(string) ClaimOutcome {
	w.claimed++
	if w.claimOK {
		return ClaimGranted
	}
	return ClaimBusy
}
func (w *fakeWorker) Release() { w.released++ }
func (w *fakeWorker) Touch()   {}
func (w *fakeWorker) PostMessage(_ context.Context, _, _, resumeToken string) error {
	w.gotResumeToken = resumeToken
	return w.postErr
}
func (w *fakeWorker) StreamEvents(ctx context.Context, sink ChatSink) error {
	if w.streamWrites {
		_ = sink.Emit(okf(frames.Delta("hello")))
	}
	if w.blockUntilCancel {
		<-ctx.Done()
	}
	return w.streamErr
}

// fakeRelay hands out one captureStream per turn so a test can inspect the frames
// the turn pushed to the relay.
type fakeRelay struct{ stream *captureStream }

func (r *fakeRelay) Open(context.Context, string, string, string, string, string, string) (FrameStream, error) {
	r.stream = &captureStream{}
	return r.stream, nil
}

// frameTypes lists the `type` discriminant of each pushed frame, in order.
func frameTypes(fs []frames.Frame) []string {
	out := make([]string, 0, len(fs))
	for _, f := range fs {
		var p struct {
			Type string `json:"type"`
		}
		_ = json.Unmarshal([]byte(f.JSON()), &p)
		out = append(out, p.Type)
	}
	return out
}

func has(types []string, want string) bool {
	for _, t := range types {
		if t == want {
			return true
		}
	}
	return false
}

func newTestApp(pool WorkerPool, relay FrameRelay) *App {
	return New(WithWorkerPool(pool), WithFrameRelay(relay))
}

func req() ChatRequest {
	return ChatRequest{ConversationID: "c1", Prompt: "hi", RunToken: "rt-secret", Credentials: domain.Credentials{
		LangwatchAPIKey: "k", LLMVirtualKey: "vk", GatewayBaseURL: "g", LangwatchEndpoint: "e",
	}}
}

// runTurn drives StartTurn's returned runner to completion synchronously (the
// transport runs it detached; the test does it in-line to observe the outcome).
func runTurn(t *testing.T, a *App, r ChatRequest) {
	t.Helper()
	run, err := a.StartTurn(context.Background(), r)
	if err != nil {
		t.Fatalf("StartTurn: %v", err)
	}
	run(context.Background())
}

func TestApp_StartTurn_AtCapacityReturnsMaxWorkers(t *testing.T) {
	pool := &fakePool{acquireErr: herr.New(context.Background(), domain.ErrMaxWorkers, nil)}
	_, err := newTestApp(pool, &fakeRelay{}).StartTurn(context.Background(), req())
	if err == nil || !herr.IsCode(err, domain.ErrMaxWorkers) {
		t.Fatalf("at capacity must return herr(ErrMaxWorkers) (transport → 503), got %v", err)
	}
}

func TestApp_StartTurn_ConversationBusyReturns409(t *testing.T) {
	worker := &fakeWorker{claimOK: false}
	_, err := newTestApp(&fakePool{worker: worker}, &fakeRelay{}).StartTurn(context.Background(), req())
	if err == nil || !herr.IsCode(err, domain.ErrConversationBusy) {
		t.Fatalf("a busy conversation must return herr(ErrConversationBusy), got %v", err)
	}
	if worker.claimed != 1 {
		t.Errorf("StartTurn must attempt the claim exactly once, got %d", worker.claimed)
	}
}

func TestApp_Turn_SessionVanishedRecyclesWorkerAndEmitsError(t *testing.T) {
	worker := &fakeWorker{
		claimOK:          true,
		postErr:          herr.New(context.Background(), domain.ErrSessionNotFound, nil),
		blockUntilCancel: true,
	}
	pool := &fakePool{worker: worker}
	relay := &fakeRelay{}
	runTurn(t, newTestApp(pool, relay), req())

	if len(pool.killed) != 1 || pool.killed[0] != "c1" {
		t.Errorf("expected the vanished-session worker to be recycled, killed=%v", pool.killed)
	}
	if !has(frameTypes(relay.stream.emitted), "error") {
		t.Errorf("session-not-found must push a terminal error frame, got %v", frameTypes(relay.stream.emitted))
	}
	if worker.released != 1 {
		t.Errorf("worker must be released exactly once, got %d", worker.released)
	}
}

func TestApp_Turn_PostErrorEmitsErrorFrame(t *testing.T) {
	worker := &fakeWorker{claimOK: true, postErr: errors.New("boom-post"), blockUntilCancel: true}
	relay := &fakeRelay{}
	runTurn(t, newTestApp(&fakePool{worker: worker}, relay), req())

	if !has(frameTypes(relay.stream.emitted), "error") {
		t.Errorf("a post error must push a terminal error frame, got %v", frameTypes(relay.stream.emitted))
	}
	if worker.released != 1 {
		t.Errorf("worker must be released exactly once, got %d", worker.released)
	}
}

func TestApp_Turn_StreamErrorEmitsErrorFrame(t *testing.T) {
	worker := &fakeWorker{claimOK: true, streamErr: errors.New("boom-stream")}
	relay := &fakeRelay{}
	runTurn(t, newTestApp(&fakePool{worker: worker}, relay), req())

	// The stream error's message rides the error frame; assert both the type and
	// that the message reached the wire.
	var sawErr bool
	for _, f := range relay.stream.emitted {
		var e struct {
			Type  string `json:"type"`
			Error string `json:"error"`
		}
		_ = json.Unmarshal([]byte(f.JSON()), &e)
		if e.Type == "error" && e.Error == "boom-stream" {
			sawErr = true
		}
	}
	if !sawErr {
		t.Errorf("stream error must push an error frame carrying its message, got %v", frameTypes(relay.stream.emitted))
	}
}

func TestApp_Turn_HappyPathEmitsDeltaThenFinalAndReleases(t *testing.T) {
	worker := &fakeWorker{claimOK: true, streamWrites: true}
	relay := &fakeRelay{}
	runTurn(t, newTestApp(&fakePool{worker: worker}, relay), req())

	types := frameTypes(relay.stream.emitted)
	if !has(types, "delta") {
		t.Errorf("the streamed delta must reach the relay, got %v", types)
	}
	if !has(types, "final") {
		t.Errorf("a completed turn must push a terminal final frame, got %v", types)
	}
	if has(types, "error") {
		t.Errorf("the happy path must push no error frame, got %v", types)
	}
	if !relay.stream.closed {
		t.Errorf("the relay stream must be closed at turn end")
	}
	if worker.claimed != 1 || worker.released != 1 {
		t.Errorf("worker must be claimed and released exactly once, got claimed=%d released=%d", worker.claimed, worker.released)
	}
}

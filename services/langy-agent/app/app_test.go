package app

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langy-agent/domain"
)

// --- fakes ---

type fakePool struct {
	acquireErr error
	worker     Worker
	killed     []string
}

func (f *fakePool) Acquire(_ context.Context, _ string, _ domain.Credentials) (Worker, error) {
	if f.acquireErr != nil {
		return nil, f.acquireErr
	}
	return f.worker, nil
}
func (f *fakePool) Status() (int, int)            { return 0, 0 }
func (f *fakePool) KillSessionVanished(id string) { f.killed = append(f.killed, id) }
func (f *fakePool) StartReaper()                  {}
func (f *fakePool) Shutdown()                     {}

type fakeWorker struct {
	claimOK          bool
	claimed          int
	released         int
	postErr          error
	streamErr        error
	streamWrites     bool // write one event on the stream (happy path)
	blockUntilCancel bool // wait for ctx cancellation before returning (post-error path)
}

func (w *fakeWorker) Claim() bool { w.claimed++; return w.claimOK }
func (w *fakeWorker) Release()    { w.released++ }
func (w *fakeWorker) Touch()      {}
func (w *fakeWorker) PostMessage(_ context.Context, _, _ string) error {
	return w.postErr
}
func (w *fakeWorker) StreamEvents(ctx context.Context, sink ChatSink) error {
	if w.streamWrites {
		_, _ = sink.Write([]byte("{\"type\":\"message.part.delta\"}\n"))
	}
	if w.blockUntilCancel {
		<-ctx.Done()
	}
	return w.streamErr
}

type fakeSink struct {
	mu     sync.Mutex
	begun  bool
	events []string
	buf    bytes.Buffer
}

func (s *fakeSink) Begin() { s.mu.Lock(); s.begun = true; s.mu.Unlock() }
func (s *fakeSink) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}
func (s *fakeSink) ErrorEvent(msg string) {
	s.mu.Lock()
	s.events = append(s.events, msg)
	s.mu.Unlock()
}
func (s *fakeSink) Flush() {}

func (s *fakeSink) snapshot() (bool, []string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.begun, append([]string(nil), s.events...), s.buf.String()
}

func newApp(pool WorkerPool) *App {
	return New(WithWorkerPool(pool))
}

func req() ChatRequest {
	return ChatRequest{ConversationID: "c1", Prompt: "hi", Credentials: domain.Credentials{
		LangwatchAPIKey: "k", LLMVirtualKey: "vk", GatewayBaseURL: "g", LangwatchEndpoint: "e",
	}}
}

func TestApp_Chat_AtCapacityEmitsErrorEventAnd200(t *testing.T) {
	pool := &fakePool{acquireErr: herr.New(context.Background(), domain.ErrMaxWorkers, nil)}
	sink := &fakeSink{}
	if err := newApp(pool).Chat(context.Background(), req(), sink); err != nil {
		t.Fatalf("at-capacity must not return an error to the caller, got %v", err)
	}
	begun, events, _ := sink.snapshot()
	if !begun {
		t.Errorf("at-capacity should begin the stream (200)")
	}
	if len(events) != 1 || events[0] != "at-capacity" {
		t.Errorf("expected a single at-capacity error event, got %v", events)
	}
}

func TestApp_Chat_ConversationBusyReturns409WithoutBeginningStream(t *testing.T) {
	worker := &fakeWorker{claimOK: false}
	pool := &fakePool{worker: worker}
	sink := &fakeSink{}
	err := newApp(pool).Chat(context.Background(), req(), sink)
	if err == nil || !herr.IsCode(err, domain.ErrConversationBusy) {
		t.Fatalf("expected herr(ErrConversationBusy), got %v", err)
	}
	begun, _, _ := sink.snapshot()
	if begun {
		t.Errorf("a busy conversation must NOT begin the 200 stream (the transport writes a 409)")
	}
}

func TestApp_Chat_SessionVanishedRecyclesWorkerAndReportsEvent(t *testing.T) {
	worker := &fakeWorker{
		claimOK:          true,
		postErr:          herr.New(context.Background(), domain.ErrSessionNotFound, nil),
		blockUntilCancel: true,
	}
	pool := &fakePool{worker: worker}
	sink := &fakeSink{}
	if err := newApp(pool).Chat(context.Background(), req(), sink); err != nil {
		t.Fatalf("session-not-found is surfaced as an event, not a returned error; got %v", err)
	}
	if len(pool.killed) != 1 || pool.killed[0] != "c1" {
		t.Errorf("expected the vanished-session worker to be recycled, killed=%v", pool.killed)
	}
	_, events, _ := sink.snapshot()
	if len(events) != 1 || events[0] != "session-not-found" {
		t.Errorf("expected a session-not-found event, got %v", events)
	}
	if worker.released != 1 {
		t.Errorf("worker must be released exactly once, got %d", worker.released)
	}
}

func TestApp_Chat_PostErrorSurfacedAsEvent(t *testing.T) {
	worker := &fakeWorker{
		claimOK:          true,
		postErr:          errors.New("boom-post"),
		blockUntilCancel: true,
	}
	pool := &fakePool{worker: worker}
	sink := &fakeSink{}
	if err := newApp(pool).Chat(context.Background(), req(), sink); err != nil {
		t.Fatalf("post error is surfaced as an event, got returned err %v", err)
	}
	_, events, _ := sink.snapshot()
	if len(events) != 1 || events[0] != "boom-post" {
		t.Errorf("expected the post error surfaced as an event, got %v", events)
	}
}

func TestApp_Chat_StreamErrorSurfacedAsEvent(t *testing.T) {
	worker := &fakeWorker{claimOK: true, streamErr: errors.New("boom-stream")}
	pool := &fakePool{worker: worker}
	sink := &fakeSink{}
	if err := newApp(pool).Chat(context.Background(), req(), sink); err != nil {
		t.Fatalf("stream error is surfaced as an event, got returned err %v", err)
	}
	_, events, _ := sink.snapshot()
	if len(events) != 1 || events[0] != "boom-stream" {
		t.Errorf("expected the stream error surfaced as an event, got %v", events)
	}
}

func TestApp_Chat_HappyPathStreamsAndReleases(t *testing.T) {
	worker := &fakeWorker{claimOK: true, streamWrites: true}
	pool := &fakePool{worker: worker}
	sink := &fakeSink{}
	if err := newApp(pool).Chat(context.Background(), req(), sink); err != nil {
		t.Fatalf("happy path should not error, got %v", err)
	}
	begun, events, body := sink.snapshot()
	if !begun {
		t.Errorf("happy path must begin the 200 stream")
	}
	if len(events) != 0 {
		t.Errorf("happy path must emit no error events, got %v", events)
	}
	if !strings.Contains(body, "message.part.delta") {
		t.Errorf("expected the streamed event to reach the sink, body=%q", body)
	}
	if worker.claimed != 1 || worker.released != 1 {
		t.Errorf("worker must be claimed and released exactly once, got claimed=%d released=%d", worker.claimed, worker.released)
	}
}

package app

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel/trace"

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
	claimOutcomes    []ClaimOutcome
	claimed          int
	released         int
	touched          int
	posted           int
	postErr          error
	gotResumeToken   string
	streamErr        error
	streamWrites     bool // emit one delta frame on the stream (happy path)
	blockUntilCancel bool // wait for ctx cancellation before returning (post-error path)
	// turnTraceContexts records every SetTurnTraceContext call, so tests can
	// assert the turn's trace context is pinned on the worker before the prompt.
	turnTraceContexts []trace.SpanContext
	// llmErr/llmErrOK stub LastLLMError — the captured gateway herr a mediated
	// LLM call failed with, riding the agent_error frame as a reason.
	llmErr   herr.E
	llmErrOK bool
	// servedTurn stubs HasServedTurn — drives the ready-status wording.
	servedTurn bool
	// forwardedFailure / forwardedTurnSpans record the deferred customer
	// turn-span forward: the failure it carried (nil on success) and that the
	// forward happened at all.
	forwardedFailure   *domain.TurnFailure
	forwardedTurnSpans int
}

func (w *fakeWorker) ClaimTurn(string) ClaimOutcome {
	w.claimed++
	if len(w.claimOutcomes) >= w.claimed {
		return w.claimOutcomes[w.claimed-1]
	}
	if w.claimOK {
		return ClaimGranted
	}
	return ClaimBusy
}
func (w *fakeWorker) Release()            { w.released++ }
func (w *fakeWorker) Touch()              { w.touched++ }
func (w *fakeWorker) HasServedTurn() bool { return w.servedTurn }
func (w *fakeWorker) ForwardTurnSpan(_ trace.SpanContext, _, _ time.Time, failure *domain.TurnFailure) {
	w.forwardedFailure = failure
	w.forwardedTurnSpans++
}

func (w *fakeWorker) SetTurnTraceContext(sc trace.SpanContext) {
	w.turnTraceContexts = append(w.turnTraceContexts, sc)
}
func (w *fakeWorker) LastLLMError() (herr.E, bool) { return w.llmErr, w.llmErrOK }
func (w *fakeWorker) PostMessage(_ context.Context, _, _, resumeToken string) error {
	w.posted++
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

func TestApp_WarmRefreshesWorkerIdleDeadline(t *testing.T) {
	worker := &fakeWorker{}
	a := newTestApp(&fakePool{worker: worker}, nil)

	if err := a.Warm(context.Background(), "c1", req().Credentials); err != nil {
		t.Fatalf("Warm: %v", err)
	}
	if worker.touched != 1 {
		t.Fatalf("warm touches = %d, want 1", worker.touched)
	}
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

// The turn's trace context is pinned on the worker's telemetry-relay entry
// BEFORE the prompt is posted, so host-mediated worker spans and mediated LLM
// calls are stitched under the right trace from the turn's first byte.
func TestApp_Turn_PinsTurnTraceContextOnWorker(t *testing.T) {
	worker := &fakeWorker{claimOK: true, streamWrites: true}
	a := newTestApp(&fakePool{worker: worker}, &fakeRelay{})

	// Simulate the transport's extracted traceparent: a remote span context on the
	// request ctx (the app runs with no tracer here, exactly like a telemetry-off
	// manager — the remote context alone must be enough).
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16},
		SpanID:     trace.SpanID{1, 2, 3, 4, 5, 6, 7, 8},
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})
	ctx := trace.ContextWithRemoteSpanContext(context.Background(), sc)

	run, err := a.StartTurn(ctx, req())
	if err != nil {
		t.Fatalf("StartTurn: %v", err)
	}
	run(ctx)

	if len(worker.turnTraceContexts) != 1 {
		t.Fatalf("SetTurnTraceContext calls = %d, want exactly 1", len(worker.turnTraceContexts))
	}
	if got := worker.turnTraceContexts[0]; got.TraceID() != sc.TraceID() || got.SpanID() != sc.SpanID() {
		t.Errorf("pinned trace context = %v/%v, want the request's %v/%v",
			got.TraceID(), got.SpanID(), sc.TraceID(), sc.SpanID())
	}
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

func TestApp_StartTurn_DuplicateTurnIDPostsExactlyOnce(t *testing.T) {
	worker := &fakeWorker{
		claimOutcomes: []ClaimOutcome{ClaimGranted, ClaimAlreadyHandled},
		streamWrites:  true,
	}
	a := newTestApp(&fakePool{worker: worker}, &fakeRelay{})
	r := req()
	r.TurnID = "turn-stable"

	runTurn(t, a, r)
	runTurn(t, a, r)

	if worker.claimed != 2 {
		t.Fatalf("duplicate delivery claims = %d, want 2", worker.claimed)
	}
	if worker.posted != 1 {
		t.Fatalf("duplicate delivery PostMessage calls = %d, want exactly 1", worker.posted)
	}
	if worker.released != 1 {
		t.Fatalf("only the granted claim owns a release, got %d", worker.released)
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

func TestApp_Turn_StreamErrorEmitsWorkerStoppedFrame(t *testing.T) {
	worker := &fakeWorker{claimOK: true, streamErr: errors.New("boom-stream")}
	relay := &fakeRelay{}
	runTurn(t, newTestApp(&fakePool{worker: worker}, relay), req())

	// The raw stream error is for the log ONLY — never the wire. The frame carries
	// the vetted `worker_stopped` code, which the control plane classifies into the
	// final "Langy's worker stopped" state, and a vetted message that does not leak
	// the internal error string.
	var sawWorkerStopped bool
	for _, f := range relay.stream.emitted {
		var e struct {
			Type  string `json:"type"`
			Error string `json:"error"`
			Code  string `json:"code"`
		}
		_ = json.Unmarshal([]byte(f.JSON()), &e)
		if e.Type == "error" {
			if e.Code != "worker_stopped" {
				t.Errorf("stream error frame must carry the worker_stopped code, got %q", e.Code)
			}
			if e.Error == "boom-stream" {
				t.Errorf("raw stream error must not reach the wire, got %q", e.Error)
			}
			sawWorkerStopped = true
		}
	}
	if !sawWorkerStopped {
		t.Errorf("stream error must push a terminal error frame, got %v", frameTypes(relay.stream.emitted))
	}
}

func TestApp_Turn_AgentErrorFrameCarriesTypedCauseChain(t *testing.T) {
	// The agent reported its own failure (an opencode error event) and the LLM
	// proxy captured the gateway's typed herr for this turn. The wire frame must
	// be the vetted agent_error herr with the gateway's herr as a REASON — the
	// full typed chain the control plane deserializes into a DomainError — and
	// the raw agent prose must stay in the log, never on the wire.
	rawAgentProse := "AI_APICallError: something opencode made up"
	worker := &fakeWorker{
		claimOK:   true,
		streamErr: herr.NewLight(context.Background(), domain.ErrAgentError, nil, errors.New(rawAgentProse)),
		llmErr: herr.NewLight(context.Background(), "no_provider_configured",
			herr.M{"message": "no model provider configured", "http_status": 400}),
		llmErrOK: true,
	}
	relay := &fakeRelay{}
	runTurn(t, newTestApp(&fakePool{worker: worker}, relay), req())

	var sawAgentError bool
	for _, f := range relay.stream.emitted {
		var e struct {
			Type  string         `json:"type"`
			Error string         `json:"error"`
			Code  string         `json:"code"`
			Herr  herr.ErrorBody `json:"herr"`
		}
		_ = json.Unmarshal([]byte(f.JSON()), &e)
		if e.Type != "error" {
			continue
		}
		sawAgentError = true
		if e.Code != "agent_error" {
			t.Errorf("frame code = %q, want agent_error", e.Code)
		}
		if e.Herr.Type != "agent_error" {
			t.Errorf("frame herr type = %q, want agent_error", e.Herr.Type)
		}
		if len(e.Herr.Reasons) != 1 || e.Herr.Reasons[0].Type != "no_provider_configured" {
			t.Fatalf("frame herr reasons = %+v, want the captured gateway herr", e.Herr.Reasons)
		}
		if e.Herr.Reasons[0].Message != "no model provider configured" {
			t.Errorf("gateway reason message = %q", e.Herr.Reasons[0].Message)
		}
		if s := f.JSON(); strings.Contains(s, rawAgentProse) {
			t.Errorf("raw agent prose must never reach the wire: %s", s)
		}
	}
	if !sawAgentError {
		t.Errorf("agent error must push a terminal error frame, got %v", frameTypes(relay.stream.emitted))
	}
}

func TestApp_Turn_AgentErrorWithoutCapturedCauseStillEmitsTypedFrame(t *testing.T) {
	worker := &fakeWorker{
		claimOK:   true,
		streamErr: herr.NewLight(context.Background(), domain.ErrAgentError, nil, errors.New("raw prose")),
	}
	relay := &fakeRelay{}
	runTurn(t, newTestApp(&fakePool{worker: worker}, relay), req())

	var sawAgentError bool
	for _, f := range relay.stream.emitted {
		var e struct {
			Type string         `json:"type"`
			Code string         `json:"code"`
			Herr herr.ErrorBody `json:"herr"`
		}
		_ = json.Unmarshal([]byte(f.JSON()), &e)
		if e.Type == "error" {
			sawAgentError = true
			if e.Code != "agent_error" || e.Herr.Type != "agent_error" {
				t.Errorf("frame = code %q / herr %q, want agent_error both", e.Code, e.Herr.Type)
			}
			if len(e.Herr.Reasons) != 0 {
				t.Errorf("no captured LLM error ⇒ no reasons on the wire, got %+v", e.Herr.Reasons)
			}
		}
	}
	if !sawAgentError {
		t.Errorf("agent error must push a terminal error frame, got %v", frameTypes(relay.stream.emitted))
	}
}

// The customer-facing turn span must SHOW how the turn ended: the deferred
// forward carries nil on success and the vetted failure (code + client-safe
// message) on error — with the captured provider message when there is one,
// so the trace names the real failure instead of a generic wrapper.
func TestApp_Turn_ForwardsTurnSpanOutcome(t *testing.T) {
	turnCtx := func() context.Context {
		return trace.ContextWithRemoteSpanContext(context.Background(),
			trace.NewSpanContext(trace.SpanContextConfig{
				TraceID:    trace.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16},
				SpanID:     trace.SpanID{1, 2, 3, 4, 5, 6, 7, 8},
				TraceFlags: trace.FlagsSampled,
				Remote:     true,
			}))
	}
	drive := func(t *testing.T, worker *fakeWorker) {
		t.Helper()
		a := newTestApp(&fakePool{worker: worker}, &fakeRelay{})
		run, err := a.StartTurn(context.Background(), req())
		if err != nil {
			t.Fatalf("StartTurn: %v", err)
		}
		// The transport re-injects the extracted traceparent on the detached
		// runner ctx; with no tracer the remote context IS the turn span
		// context (the telemetry-off posture driveTurn documents).
		run(turnCtx())
		if worker.forwardedTurnSpans != 1 {
			t.Fatalf("turn span forwards = %d, want exactly one", worker.forwardedTurnSpans)
		}
	}

	t.Run("when the turn completes", func(t *testing.T) {
		worker := &fakeWorker{claimOK: true, streamWrites: true}
		drive(t, worker)
		if worker.forwardedFailure != nil {
			t.Errorf("a completed turn must forward no failure, got %+v", worker.forwardedFailure)
		}
	})

	t.Run("when the agent errors with a captured provider cause", func(t *testing.T) {
		providerMessage := "Your credit balance is too low to access the Anthropic API."
		worker := &fakeWorker{
			claimOK:   true,
			streamErr: herr.NewLight(context.Background(), domain.ErrAgentError, nil),
			llmErr: herr.E{Code: "llm_upstream_error", Meta: herr.M{
				"message": providerMessage, "http_status": 400,
			}},
			llmErrOK: true,
		}
		drive(t, worker)
		if worker.forwardedFailure == nil {
			t.Fatal("a failed turn must forward its failure")
		}
		if worker.forwardedFailure.Code != "agent_error" {
			t.Errorf("failure code = %q, want agent_error", worker.forwardedFailure.Code)
		}
		if worker.forwardedFailure.Message != providerMessage {
			t.Errorf("failure message = %q, want the provider's own message", worker.forwardedFailure.Message)
		}
	})

	t.Run("when the agent errors with no captured cause", func(t *testing.T) {
		worker := &fakeWorker{
			claimOK:   true,
			streamErr: herr.NewLight(context.Background(), domain.ErrAgentError, nil),
		}
		drive(t, worker)
		if worker.forwardedFailure == nil {
			t.Fatal("a failed turn must forward its failure")
		}
		if worker.forwardedFailure.Message != "the agent hit an error before finishing" {
			t.Errorf("failure message = %q, want the vetted generic line", worker.forwardedFailure.Message)
		}
	})

	t.Run("when the worker stream dies", func(t *testing.T) {
		worker := &fakeWorker{claimOK: true, streamErr: errors.New("boom-stream")}
		drive(t, worker)
		if worker.forwardedFailure == nil || worker.forwardedFailure.Code != "worker_stopped" {
			t.Fatalf("failure = %+v, want worker_stopped", worker.forwardedFailure)
		}
		if worker.forwardedFailure.Message == "boom-stream" {
			t.Error("the raw stream error must not become the customer span message")
		}
	})
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

// statusOf returns the FIRST status frame's text, or "" if none was emitted.
func statusOf(fs []frames.Frame) string {
	for _, f := range fs {
		var s struct {
			Type   string `json:"type"`
			Status string `json:"status"`
		}
		_ = json.Unmarshal([]byte(f.JSON()), &s)
		if s.Type == "status" {
			return s.Status
		}
	}
	return ""
}

// A worker that has never answered says Langy is waking up — one of the
// wake-flavoured lines, never a warm reaching line.
func TestApp_Turn_NeverServedWorkerEmitsWakingUpStatus(t *testing.T) {
	worker := &fakeWorker{claimOK: true, streamWrites: true}
	relay := &fakeRelay{}
	runTurn(t, newTestApp(&fakePool{worker: worker}, relay), req())

	got := statusOf(relay.stream.emitted)
	if !slices.Contains(wakingLangyStatuses, got) {
		t.Errorf("cold readiness status = %q, want one of %v", got, wakingLangyStatuses)
	}
}

// A warm worker gets a short reaching-Langy line, chosen from the rotation —
// never the waking-up line, which would claim a boot that isn't happening.
func TestApp_Turn_WarmWorkerEmitsReachingLangyStatus(t *testing.T) {
	worker := &fakeWorker{claimOK: true, streamWrites: true, servedTurn: true}
	relay := &fakeRelay{}
	runTurn(t, newTestApp(&fakePool{worker: worker}, relay), req())

	got := statusOf(relay.stream.emitted)
	if !slices.Contains(reachingLangyStatuses, got) {
		t.Errorf("warm readiness status = %q, want one of %v", got, reachingLangyStatuses)
	}
}

// The warm rotation is deterministic per turn (a re-drive repeats its line) and
// actually varies across turn ids.
func TestApp_ReadyStatus_WarmRotationVariesByTurn(t *testing.T) {
	worker := &fakeWorker{servedTurn: true}
	seen := map[string]struct{}{}
	for _, turnID := range []string{"turn-a", "turn-b", "turn-c", "turn-d", "turn-e", "turn-f"} {
		r := req()
		r.TurnID = turnID
		first := readyStatusFor(r, worker)
		if again := readyStatusFor(r, worker); again != first {
			t.Fatalf("ready status for %q not deterministic: %q then %q", turnID, first, again)
		}
		seen[first] = struct{}{}
	}
	if len(seen) < 2 {
		t.Errorf("six turn ids produced %d distinct warm lines, want at least 2", len(seen))
	}
}

// A turn resuming from a shutdown handoff (ADR-048) says it is picking the
// checkpointed turn back up, not cold-starting.
func TestApp_Turn_ResumeFromHandoffEmitsPickingUpStatus(t *testing.T) {
	worker := &fakeWorker{claimOK: true, streamWrites: true}
	relay := &fakeRelay{}
	r := req()
	r.ResumeToken = "resume-token-abc"
	runTurn(t, newTestApp(&fakePool{worker: worker}, relay), r)

	if got := statusOf(relay.stream.emitted); got != "Picking up where it left off…" {
		t.Errorf("resume readiness status = %q, want the picking-up line", got)
	}
}

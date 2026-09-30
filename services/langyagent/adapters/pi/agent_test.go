package pi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// frameSink is a thread-safe app.ChatSink capturing emitted frame payloads
// (the heartbeat goroutine emits concurrently with the event loop).
type frameSink struct {
	mu      sync.Mutex
	emitted []string
}

func (s *frameSink) Emit(f frames.Frame) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.emitted = append(s.emitted, f.JSON())
	return nil
}

func (s *frameSink) all() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.emitted...)
}

func (s *frameSink) joined() string { return strings.Join(s.all(), "\n") }

// waitFor polls until the sink's joined payloads contain want, or fails.
func (s *frameSink) waitFor(t *testing.T, want string) {
	t.Helper()
	// Comfortably past one heartbeat interval (5s), which is the slowest
	// frame any test waits on.
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(s.joined(), want) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("sink never saw %q; frames:\n%s", want, s.joined())
}

// runTurn drives a full turn the way app.go does: the Stream consumer is
// launched FIRST, then the turn is posted, the production ordering with no
// guarantee between them. Returns the sink and the stream outcome.
func runTurn(t *testing.T, agent *Agent, turnID string) (*frameSink, error) {
	t.Helper()
	return runTurnIn(t, context.Background(), agent, turnID)
}

// runTurnIn is runTurn on the caller's context (one carrying a test logger).
func runTurnIn(t *testing.T, base context.Context, agent *Agent, turnID string) (*frameSink, error) {
	t.Helper()
	sink := &frameSink{}
	ctx, cancel := context.WithTimeout(base, 10*time.Second)
	t.Cleanup(cancel)

	errCh := make(chan error, 1)
	go func() { errCh <- agent.Stream(ctx, "sess", sink) }()

	if err := agent.Post(ctx, "sess", app.Turn{TurnID: turnID, Prompt: "hi"}); err != nil {
		t.Fatalf("Post: %v", err)
	}
	select {
	case err := <-errCh:
		return sink, err
	case <-time.After(8 * time.Second):
		t.Fatalf("Stream never returned; frames:\n%s", sink.joined())
		return sink, nil
	}
}

// The ready handshake's resumed announcement reaches OpenSession, which is
// how the pool learns to skip the transcript seed for a worker that resumed
// the session its home still held. A wrapper that says nothing (or an older
// binary that never emits the field) reads as false and keeps the seed path.
//
// @scenario "A respawned pi worker resumes the conversation's persisted session"
func TestAgent_OpenSession_RelaysWrapperSessionResume(t *testing.T) {
	for _, tc := range []struct {
		mode string
		want bool
	}{
		{mode: "resumed", want: true},
		{mode: "happy", want: false},
	} {
		agent := spawnFake(t, tc.mode, 20*time.Second)
		if err := agent.WaitReady(context.Background()); err != nil {
			t.Fatalf("WaitReady(%s): %v", tc.mode, err)
		}
		_, resumed, err := agent.OpenSession(context.Background())
		if err != nil {
			t.Fatalf("OpenSession(%s): %v", tc.mode, err)
		}
		if resumed != tc.want {
			t.Errorf("OpenSession(%s) resumed = %v, want %v", tc.mode, resumed, tc.want)
		}
	}
}

// The full happy path over a real subprocess: ready handshake, delta,
// reasoning, the tool lifecycle (with the composite opaque id the responses
// lane produces), the plan snapshot + measured progress, and a clean nil
// terminal.
func TestAgent_HappyTurn_StreamsFramesAndSettlesClean(t *testing.T) {
	agent := spawnFake(t, "happy", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}

	sink, err := runTurn(t, agent, "turn-1")
	if err != nil {
		t.Fatalf("Stream = %v, want nil on turn_done ok", err)
	}
	joined := sink.joined()
	for _, want := range []string{
		`"type":"delta"`, `"text":"Hello"`,
		`"type":"reasoning"`, `"text":"thinking hard"`,
		`"id":"call_1|fc_1"`, `"phase":"start"`, `"phase":"end"`,
		`"output":"file.txt"`, `"local":true`,
		`"type":"plan"`, `"Scanning traces — 2/4"`,
		`"type":"progress"`, `"current":2`, `"total":4`,
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("frames missing %s; got:\n%s", want, joined)
		}
	}
	// Text resuming after the tool call restores the paragraph break.
	if !strings.Contains(joined, `"text":"\n\nworld"`) {
		t.Errorf("post-tool delta should carry the paragraph restore, got:\n%s", joined)
	}
	// Exactly one start and one end for the call id.
	if got := strings.Count(joined, `"phase":"start"`); got != 1 {
		t.Errorf("start frames = %d, want exactly 1", got)
	}
	if got := strings.Count(joined, `"phase":"end"`); got != 1 {
		t.Errorf("end frames = %d, want exactly 1", got)
	}
}

// The wrapper's guided turn end guard reports through the protocol, since the
// wrapper's stderr is discarded: the manager logs the event under the guard's
// own name with the turn id and what the turn owed, and draws no frame for it.
//
// @scenario "The manager logs the guard's report under its name"
func TestAgent_GuidedTurnEvent_IsLoggedNotFramed(t *testing.T) {
	agent := spawnFake(t, "guided", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}
	core, logs := observer.New(zapcore.InfoLevel)
	// The turn's logger carries the turn id, as the transport's turnLogFields
	// attach it to every turn request.
	ctx := clog.With(clog.Set(context.Background(), zap.New(core)), zap.String("turn_id", "turn-1"))

	sink, err := runTurnIn(t, ctx, agent, "turn-1")
	if err != nil {
		t.Fatalf("Stream = %v, want nil on turn_done ok", err)
	}
	if strings.Contains(sink.joined(), "guided") {
		t.Errorf("guided_turn must draw no frame, got:\n%s", sink.joined())
	}
	entries := logs.FilterMessage("guided_turn_continued").All()
	if len(entries) != 1 {
		t.Fatalf("guided_turn_continued log lines = %d, want 1; all lines: %v", len(entries), logs.All())
	}
	fields := entries[0].ContextMap()
	if got := fields["turn_id"]; got != "turn-1" {
		t.Errorf("turn_id = %v, want turn-1", got)
	}
	if got := fields["missing"]; got != "the branch line; the first scenario card" {
		t.Errorf("missing = %v, want the guard's two items on one string", got)
	}
	if got := fields["segment"]; got != int64(1) {
		t.Errorf("segment = %v, want 1", got)
	}
}

// ansiSequence matches the color codes the pretty console writes.
var ansiSequence = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// captureStdout runs fn with os.Stdout redirected into a pipe and returns
// what was written. The pretty console core locks os.Stdout when the logger
// is built, so the logger has to be built inside fn.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	was := os.Stdout
	os.Stdout = w
	done := make(chan string, 1)
	go func() {
		b, _ := io.ReadAll(r)
		done <- string(b)
	}()
	func() {
		defer func() {
			os.Stdout = was
			_ = w.Close()
		}()
		fn()
	}()
	return <-done
}

// The report as the manager's console writes it: one line, found by a grep
// for the event name, carrying the turn id once and what the turn owed. The
// pretty console draws an array field on a continuation line and repeats a
// key the logger already carries, which a test logger's field map does not
// show, so this goes through the real logger setup.
//
// @scenario "The manager logs the guard's report under its name"
func TestAgent_GuidedTurnEvent_PrettyConsoleLine(t *testing.T) {
	agent := spawnFake(t, "guided", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}
	out := captureStdout(t, func() {
		logger := clog.New(context.Background(), clog.Config{Format: "pretty"})
		ctx := clog.With(clog.Set(context.Background(), logger), zap.String("turn_id", "turn-1"))
		if _, err := runTurnIn(t, ctx, agent, "turn-1"); err != nil {
			t.Errorf("Stream = %v, want nil on turn_done ok", err)
		}
		_ = logger.Sync()
	})
	var line string
	for _, candidate := range strings.Split(ansiSequence.ReplaceAllString(out, ""), "\n") {
		if strings.Contains(candidate, "guided_turn_continued") {
			line = candidate
			break
		}
	}
	if line == "" {
		t.Fatalf("no guided_turn_continued line on the console; output:\n%s", out)
	}
	if got := strings.Count(line, "turn_id="); got != 1 {
		t.Errorf("turn_id appears %d times on the line, want once:\n%s", got, line)
	}
	if !strings.Contains(line, "missing=") || !strings.Contains(line, "the branch line; the first scenario card") {
		t.Errorf("the line must carry what the turn owed:\n%s", line)
	}
	if !strings.Contains(line, "segment=1") {
		t.Errorf("the line must name the segment:\n%s", line)
	}
}

// The demux race in the other direction: the turn is POSTED first and its
// events land in the mailbox before any Stream attaches; the late Stream must
// receive everything.
func TestAgent_PostBeforeStream_NoFrameIsLost(t *testing.T) {
	agent := spawnFake(t, "happy", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := agent.Post(ctx, "sess", app.Turn{TurnID: "turn-race", Prompt: "hi"}); err != nil {
		t.Fatalf("Post: %v", err)
	}
	// Give the wrapper time to emit the whole turn INTO the mailbox buffer.
	time.Sleep(300 * time.Millisecond)

	sink := &frameSink{}
	if err := agent.Stream(ctx, "sess", sink); err != nil {
		t.Fatalf("Stream = %v, want nil", err)
	}
	joined := sink.joined()
	if !strings.Contains(joined, `"text":"Hello"`) || !strings.Contains(joined, `"type":"plan"`) {
		t.Errorf("late-attaching stream lost frames; got:\n%s", joined)
	}
}

// turn_done error maps to the herr agent_error carrying the wrapper's message
// as a log-only reason, the exact code app.go dispatches on.
func TestAgent_ErrorTerminal_MapsToAgentError(t *testing.T) {
	agent := spawnFake(t, "error", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}

	_, err := runTurn(t, agent, "turn-err")
	if !herr.IsCode(err, domain.ErrAgentError) {
		t.Fatalf("Stream = %v, want herr(agent_error)", err)
	}
	if !strings.Contains(err.Error(), "model exploded") {
		t.Errorf("the wrapper's message must ride as a reason for the log, got %v", err)
	}
}

// A shutdown-imminent notice mid-turn terminates with a handoff: the digest
// seed rides a terminal frames.Handoff and the stream returns the ADR-048
// sentinel so the app skips its own terminal frame.
func TestAgent_Handoff_EmitsResumeTokenAndSentinel(t *testing.T) {
	agent := spawnFake(t, "handoff", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}

	sink := &frameSink{}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- agent.Stream(ctx, "sess", sink) }()
	if err := agent.Post(ctx, "sess", app.Turn{TurnID: "turn-h", Prompt: "hi"}); err != nil {
		t.Fatalf("Post: %v", err)
	}
	sink.waitFor(t, `"text":"partial"`) // the turn is running
	if err := agent.NotifyShutdownImminent(ctx, "sess", time.Now().Add(time.Second)); err != nil {
		t.Fatalf("NotifyShutdownImminent: %v", err)
	}

	select {
	case err := <-errCh:
		if !errors.Is(err, domain.ErrTurnHandedOff) {
			t.Fatalf("Stream = %v, want ErrTurnHandedOff", err)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("Stream never returned after shutdown_imminent")
	}
	if !strings.Contains(sink.joined(), `"resumeToken":"SEED-42"`) {
		t.Errorf("the handoff frame must carry the digest seed; got:\n%s", sink.joined())
	}
}

// The abort path (ADR-078): the wire abort names the turn, the wrapper ignores
// a mismatched id (observable via the marker delta), and the matched abort
// terminates the turn as turn_done aborted, which settles the stream CLEAN
// (nil): the control plane's stopped terminal is first-writer-wins upstream.
func TestAgent_AbortTurn_NamesTheTurnAndSettlesClean(t *testing.T) {
	agent := spawnFake(t, "abort", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}

	sink := &frameSink{}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- agent.Stream(ctx, "sess", sink) }()
	if err := agent.Post(ctx, "sess", app.Turn{TurnID: "turn-a", Prompt: "hi"}); err != nil {
		t.Fatalf("Post: %v", err)
	}
	sink.waitFor(t, `"text":"partial"`)

	// A stale cancel naming a different turn must not halt this generation.
	if err := agent.AbortTurn(ctx, "sess", "turn-other"); err != nil {
		t.Fatalf("AbortTurn (mismatched): %v", err)
	}
	sink.waitFor(t, "IGNORED-ABORT")

	if err := agent.AbortTurn(ctx, "sess", "turn-a"); err != nil {
		t.Fatalf("AbortTurn: %v", err)
	}
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("Stream after abort = %v, want nil (turn_done aborted settles clean)", err)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("Stream never returned after the matched abort")
	}
}

// Process death mid-turn (pipe EOF, no terminal) must surface as a PLAIN error
// so app.go routes it to worker_stopped, never agent_error, never a clean nil.
func TestAgent_ProcessDeathMidTurn_IsAPlainError(t *testing.T) {
	agent := spawnFake(t, "die", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}

	_, err := runTurn(t, agent, "turn-d")
	if err == nil {
		t.Fatal("Stream = nil, want an error for a worker that died mid-turn")
	}
	if herr.IsCode(err, domain.ErrAgentError) {
		t.Fatalf("Stream = %v: process death must NOT map to agent_error", err)
	}
	if errors.Is(err, domain.ErrTurnHandedOff) {
		t.Fatalf("Stream = %v: process death must NOT map to a handoff", err)
	}
}

// Reader recovery over the real pipes: an unparseable line and an oversized
// line are skipped, and the events after them still stream.
func TestAgent_JunkAndOversizedLines_AreSkippedNotFatal(t *testing.T) {
	agent := spawnFake(t, "junk", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}

	sink, err := runTurn(t, agent, "turn-j")
	if err != nil {
		t.Fatalf("Stream = %v, want nil", err)
	}
	if !strings.Contains(sink.joined(), `"text":"ok"`) {
		t.Errorf("the delta after the junk lines must still arrive; got:\n%s", sink.joined())
	}
}

// A wrapper that never emits ready maps to the same herr(ErrWorkerNotReady)
// message copy a readiness timeout produces.
func TestAgent_WaitReady_TimeoutMapsToWorkerNotReady(t *testing.T) {
	agent := spawnFake(t, "noready", 300*time.Millisecond)
	err := agent.WaitReady(context.Background())
	if !herr.IsCode(err, domain.ErrWorkerNotReady) {
		t.Fatalf("WaitReady = %v, want herr(worker_not_ready)", err)
	}
}

// A wrapper that dies before its handshake is a spawn failure, not a timeout:
// WaitReady returns promptly instead of burning the whole readiness budget.
func TestAgent_WaitReady_DeadProcessFailsFast(t *testing.T) {
	agent := spawnFake(t, "deadfast", 10*time.Second)
	start := time.Now()
	err := agent.WaitReady(context.Background())
	if !herr.IsCode(err, domain.ErrWorkerSpawn) {
		t.Fatalf("WaitReady = %v, want herr(worker_spawn_failed)", err)
	}
	if time.Since(start) > 5*time.Second {
		t.Fatalf("WaitReady took %v: death must fail fast, not wait out the timeout", time.Since(start))
	}
}

// A long silent turn still heartbeats: the manager-side ticker keeps the
// turn's liveness fresh with no wrapper output at all.
func TestAgent_Stream_HeartbeatsThroughSilence(t *testing.T) {
	agent := spawnFake(t, "abort", 20*time.Second) // holds the turn open silently
	// The real cadence is 5s; the test only proves the ticker fires at all.
	agent.progressInterval = 50 * time.Millisecond
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}

	sink := &frameSink{}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- agent.Stream(ctx, "sess", sink) }()
	if err := agent.Post(ctx, "sess", app.Turn{TurnID: "turn-hb", Prompt: "hi"}); err != nil {
		t.Fatalf("Post: %v", err)
	}
	sink.waitFor(t, `"type":"heartbeat"`)
	if err := agent.AbortTurn(ctx, "sess", "turn-hb"); err != nil {
		t.Fatalf("AbortTurn: %v", err)
	}
	<-errCh
}

// An empty control-plane turn id (older control plane) still runs: the adapter
// mints a private wire id, and the turn completes.
func TestAgent_Post_EmptyTurnIDMintsAPrivateOne(t *testing.T) {
	agent := spawnFake(t, "happy", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}
	sink, err := runTurn(t, agent, "")
	if err != nil {
		t.Fatalf("Stream = %v, want nil", err)
	}
	if !strings.Contains(sink.joined(), `"text":"Hello"`) {
		t.Errorf("turn with a minted id must still stream; got:\n%s", sink.joined())
	}
}

// The wire command shape, byte-exact where it matters: the wrapper's zod
// parser requires type/turnId/prompt and tolerates the optionals.
func TestCommandWireShape(t *testing.T) {
	body, err := json.Marshal(command{Type: "turn", TurnID: "t1", Prompt: "p", System: "s", ResumeToken: "r"})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"type":"turn","turnId":"t1","prompt":"p","system":"s","resumeToken":"r"}`
	if string(body) != want {
		t.Errorf("turn command = %s, want %s", body, want)
	}
	body, _ = json.Marshal(command{Type: "abort", TurnID: "t1"})
	if string(body) != `{"type":"abort","turnId":"t1"}` {
		t.Errorf("abort command = %s", body)
	}
	body, _ = json.Marshal(command{Type: "shutdown_imminent", DeadlineMs: 1755800000000})
	if string(body) != `{"type":"shutdown_imminent","deadlineMs":1755800000000}` {
		t.Errorf("shutdown command = %s", body)
	}
	body, _ = json.Marshal(command{Type: "ping"})
	if string(body) != `{"type":"ping"}` {
		t.Errorf("ping command = %s", body)
	}
}

// A turn abandoned between Post and Stream leaves its handle in the handoff
// channel. The NEXT turn's Stream must attach to its OWN mailbox, never to that
// leftover: app.go starts the Stream goroutine BEFORE PostMessage, so a Stream
// that wins the race against the next Post would otherwise pick up the dead
// turn's mailbox, receive nothing, and leave the live turn's mailbox filling
// until the reader blocked on it.
//
// The worker calls TurnEnded from Release at the turn boundary, which is what
// clears the orphan while no Stream is waiting.
//
// @scenario "An abandoned pi turn cannot capture the next turn's stream"
func TestAgent_AbandonedTurn_DoesNotCaptureTheNextStream(t *testing.T) {
	agent := spawnFake(t, "happy", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}

	// Turn one is posted and then abandoned: its Stream never attaches, exactly
	// as when the customer's request context dies between the two calls.
	postCtx, cancelPost := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelPost()
	if err := agent.Post(postCtx, "sess", app.Turn{TurnID: "turn-abandoned", Prompt: "hi"}); err != nil {
		t.Fatalf("Post(abandoned): %v", err)
	}

	// The turn boundary the worker drives from Release.
	agent.TurnEnded()

	// Turn two runs the production ordering: Stream first, then Post.
	sink, err := runTurn(t, agent, "turn-live")
	if err != nil {
		t.Fatalf("Stream(live) = %v, want nil", err)
	}
	if !strings.Contains(sink.joined(), `"text":"Hello"`) {
		t.Errorf("the live turn streamed nothing; got:\n%s", sink.joined())
	}

	// Which mailbox the live Stream attached to is the actual claim, and the
	// frames alone cannot show it: the abandoned turn ran to completion inside
	// the wrapper, so ITS mailbox holds the same frames and a content check
	// passes either way. Stream unregisters the mailbox it attached to, so a
	// still-registered turn-live is the leak: the live turn's events would pile
	// up in a box no one is reading.
	r := agent.currentReader()
	r.mu.Lock()
	_, liveLeaked := r.boxes["turn-live"]
	_, abandonedLeaked := r.boxes["turn-abandoned"]
	r.mu.Unlock()
	if liveLeaked {
		t.Error("the live turn's stream attached to the abandoned turn's mailbox, leaving its own registered and filling")
	}
	if abandonedLeaked {
		t.Error("the abandoned turn's mailbox outlived the turn boundary")
	}
}

// TurnEnded is called on every turn boundary, including the ordinary one where
// the handle was consumed. It must be a no-op there rather than blocking on an
// empty channel.
func TestAgent_TurnEnded_IsANoOpWhenNothingWasOrphaned(t *testing.T) {
	agent := spawnFake(t, "happy", 20*time.Second)
	if err := agent.WaitReady(context.Background()); err != nil {
		t.Fatalf("WaitReady: %v", err)
	}
	if _, err := runTurn(t, agent, "turn-clean"); err != nil {
		t.Fatalf("Stream: %v", err)
	}

	done := make(chan struct{})
	go func() {
		agent.TurnEnded()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("TurnEnded blocked on an empty handoff channel")
	}
}

package pi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
	"github.com/langwatch/langwatch/services/langyagent/internal/toolmap"
)

// progressInterval is the heartbeat cadence, mirroring adapters/opencode:
// comfortably below the control plane's HEARTBEAT_GRACE (30s) so a live but
// quiet turn is never mistaken for a dead one.
const progressInterval = 5 * time.Second

// maxStartedInputs caps the recorded tool-start inputs one turn keeps for the
// replay fallback in applyToolEnd. Only a settle deletes its entry, so an
// unbounded map would grow with every tool call the wrapper never settles.
const maxStartedInputs = 256

// Agent drives ONE langy-worker subprocess over stdio, per-worker stateful. The
// pool constructs one per worker, Provisions + Spawns through it, and the app
// then drives each turn through the app.CodingAgent port.
//
// A worker has no listener, which is the point: the pipes are held by this
// adapter and the child, so there is no port, path or name a sibling could
// dial, at any identity. The port carried an app.Endpoint on every method until
// ADR-131, because the harness that has since been removed was driven over
// loopback HTTP and needed an address; this adapter accepted and ignored it.
type Agent struct {
	readinessTimeout time.Duration

	// progressInterval is the heartbeat cadence. A field, not the package
	// constant, so a test can shorten it instead of waiting a real tick.
	progressInterval time.Duration

	// stdin is the parent's write end of the wrapper's stdin, and reader owns
	// the read end. Both are assigned by Spawn and read from every turn path,
	// so pipesMu guards both. All stdin writes are whole JSONL lines under the
	// same lock, so concurrent command writers (Post, AbortTurn,
	// NotifyShutdownImminent) can never interleave mid-line.
	pipesMu sync.Mutex
	stdin   io.WriteCloser
	reader  *reader
	// stdinBroken latches once a command write fails part-way: the wrapper's
	// stdin then carries a partial JSONL line and no later command can be
	// parsed, so writing more would only add garbage. See writeCommand.
	stdinBroken bool

	// posted hands the just-posted turn to its Stream goroutine. Capacity 1:
	// turns are serialized per worker (ClaimTurn), so at most one handle is
	// ever in flight. A handle nobody consumed (a turn abandoned between Post
	// and Stream) is dropped by TurnEnded at the turn boundary, never by the
	// next Post, which would race that turn's own Stream.
	posted chan *postedTurn
}

// currentReader returns the reader Spawn installed, under the pipe lock, so
// a turn path never reads the field while Spawn writes it.
func (a *Agent) currentReader() *reader {
	a.pipesMu.Lock()
	defer a.pipesMu.Unlock()
	return a.reader
}

// postedTurn pairs a turn id with its registered mailbox.
type postedTurn struct {
	turnID string
	mb     *mailbox
}

// Compile-time proof Agent satisfies the driven port. Abort and the turn
// boundary are part of CodingAgent since ADR-131 — they were optional
// capabilities only because the other harness implemented neither.
var _ app.CodingAgent = (*Agent)(nil)

// NewAgent returns a CodingAgent. readinessTimeout bounds WaitReady.
func NewAgent(readinessTimeout time.Duration) *Agent {
	return &Agent{
		readinessTimeout: readinessTimeout,
		progressInterval: progressInterval,
		posted:           make(chan *postedTurn, 1),
	}
}

// WaitReady blocks until the wrapper's ready handshake, the process's death,
// the readiness timeout, or ctx. The timeout maps to the same
// herr(ErrWorkerNotReady) message the opencode readiness poll returns, so the
// customer-facing copy does not depend on the harness.
func (a *Agent) WaitReady(ctx context.Context) error {
	r := a.currentReader()
	if r == nil {
		return errors.New("pi agent: WaitReady before Spawn")
	}
	timer := time.NewTimer(a.readinessTimeout)
	defer timer.Stop()
	select {
	case <-r.ready:
		return nil
	case <-r.dead:
		// The wrapper exited before its handshake, a boot failure, not a
		// timeout. Deliberately handled: the caller retries a fresh spawn.
		return herr.New(ctx, domain.ErrWorkerSpawn, herr.M{
			"message": "the assistant worker could not be started, please try again",
		})
	case <-timer.C:
		return herr.New(ctx, domain.ErrWorkerNotReady, herr.M{
			"message": "the assistant took too long to start, please try again",
		})
	case <-ctx.Done():
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			// The pool bounds WaitReady with its own readiness-timeout context;
			// its expiry IS the readiness timeout, same mapping as the timer.
			return herr.New(ctx, domain.ErrWorkerNotReady, herr.M{
				"message": "the assistant took too long to start, please try again",
			})
		}
		return ctx.Err()
	}
}

// OpenSession is local: the wrapper owns its one pi session, so there is no
// remote call to make and nothing that can fail. The returned id is a synthetic
// handle for logs and route parity; the wire protocol never carries it.
// Resumed relays the wrapper's own ready-handshake announcement: the wrapper
// continues the newest persisted session when its home still holds one (the
// home outlives the process on an idle reap or a crash), and a resumed
// session must not be re-seeded the transcript it already carries. The reader
// records the flag before closing ready, and the pool calls OpenSession only
// after WaitReady, so the read is ordered.
func (a *Agent) OpenSession(_ context.Context) (string, bool, error) {
	r := a.currentReader()
	resumed := r != nil && r.resumed
	return "pi-" + randomID(), resumed, nil
}

// Post queues one turn on the wrapper. The mailbox is registered BEFORE the
// turn line is written: app.go launches the Stream goroutine before
// PostMessage with no ordering guarantee, and the wrapper can emit
// turn_started the instant the line lands, so routing must exist first.
func (a *Agent) Post(ctx context.Context, _ string, turn app.Turn) error {
	r := a.currentReader()
	if r == nil {
		return errWorkerGone(ctx, "Post before Spawn")
	}
	turnID := turn.TurnID
	if turnID == "" {
		// An older control plane threads no turn id. Mint a private one so the
		// wire stays well-formed; an abort (which requires a name) can never
		// target it, which matches the no-id contract upstream.
		turnID = "t-" + randomID()
	}
	mb := r.register(turnID)
	if err := a.writeCommand(ctx, command{
		Type:        "turn",
		TurnID:      turnID,
		Prompt:      turn.Prompt,
		System:      turn.System,
		ResumeToken: turn.ResumeToken,
	}); err != nil {
		r.unregister(turnID, mb)
		return err
	}
	// Hand the turn to its Stream. TurnEnded emptied the channel at the previous
	// turn's boundary, so the handle offered here is the only one this turn's
	// Stream can take. Draining HERE instead would not be enough: app.go starts
	// the Stream goroutine before PostMessage, so a Stream that ran first could
	// take a leftover handle before the drain ever executed, attach to the dead
	// turn's mailbox, and leave this turn's mailbox filling until the reader
	// blocked on it.
	a.posted <- &postedTurn{turnID: turnID, mb: mb}
	return nil
}

// TurnEnded is the app.TurnBoundary capability. The worker calls it from
// Release, once Post and Stream have both returned, so it is the one moment
// where a handle still sitting in the channel is provably unclaimed: its turn
// is over and no Stream is waiting for it. Dropping it here is what keeps the
// NEXT turn's Stream from attaching to it.
func (a *Agent) TurnEnded() {
	r := a.currentReader()
	for {
		select {
		case orphan := <-a.posted:
			if r != nil {
				r.unregister(orphan.turnID, orphan.mb)
			}
			continue
		default:
			return
		}
	}
}

// Stream attaches to the posted turn's mailbox and maps its wire events onto
// typed frames until the terminal event, process death, or ctx cancellation.
//
// Terminal mapping (the locked design):
//   - turn_done ok       -> nil (the app emits the final)
//   - turn_done aborted  -> nil (the control plane's stopped terminal is
//     first-writer-wins, so a benign final changes nothing)
//   - turn_done error    -> herr(ErrAgentError) carrying the wrapper's message
//     as an unknown reason (log-only; the app composes the wire herr)
//   - handoff            -> emit frames.Handoff(seed), return ErrTurnHandedOff
//   - process death mid-turn (dead closes, no terminal) -> PLAIN error, so the
//     app routes it to worker_stopped, never agent_error
//   - ctx cancellation   -> nil
func (a *Agent) Stream(ctx context.Context, _ string, sink app.ChatSink) error {
	r := a.currentReader()
	if r == nil {
		return errors.New("pi agent: Stream before Spawn")
	}
	var turn *postedTurn
	select {
	case turn = <-a.posted:
	case <-r.dead:
		return errors.New("pi worker exited before the turn was posted")
	case <-ctx.Done():
		return nil
	}
	defer r.unregister(turn.turnID, turn.mb)

	// All emits go through emitFrame so the concurrent heartbeat ticker can
	// never interleave with the event loop: the relay push is ONE ordered
	// stream, so a single mutex serializes frame writes (opencode parity).
	// Returns false on an emit error (the relay push broke) so callers stop.
	var emitMu sync.Mutex
	emitFrame := func(f frames.Frame) bool {
		emitMu.Lock()
		defer emitMu.Unlock()
		return sink.Emit(f) == nil
	}

	// Heartbeat: a frames.Heartbeat every a.progressInterval keeps the turn's
	// liveness fresh through a long, silent tool call, the event loop blocks
	// on mailbox events and cannot self-tick through silence. Best-effort;
	// panic-guarded; joined before return so no heartbeat races teardown.
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer clog.HandlePanic(ctx, false)
		ticker := time.NewTicker(a.progressInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				hb, mErr := frames.Heartbeat()
				if mErr != nil {
					continue
				}
				// A failed beat is never a reason to stop beating. The sink
				// absorbs a broken push and reconnects on a later frame, so
				// giving up here would leave the rest of the turn with no
				// liveness at all, and the control plane ends a turn whose
				// heartbeat goes stale. Only the turn ending stops the ticker.
				emitFrame(hb)
			}
		}
	}()
	defer func() {
		close(stop)
		wg.Wait()
	}()

	st := newStreamState(emitFrame)
	for {
		select {
		case ev := <-turn.mb.ch:
			isDone, err := a.consumeEvent(ctx, st, ev)
			if isDone {
				return err
			}
		case <-r.dead:
			// The wrapper flushes a turn's terminal before it can exit, so a
			// terminal may already sit in the mailbox buffer, drain it before
			// concluding the process died mid-turn.
			for {
				select {
				case ev := <-turn.mb.ch:
					isDone, err := a.consumeEvent(ctx, st, ev)
					if isDone {
						return err
					}
					continue
				default:
				}
				break
			}
			// Plain error BY CONTRACT: the app maps it to worker_stopped.
			return errors.New("pi worker process exited mid-turn")
		case <-ctx.Done():
			return nil
		}
	}
}

// consumeEvent maps one wire event onto frames. isDone reports that the turn is
// over (terminal seen) and err is the turn's mapped outcome.
func (a *Agent) consumeEvent(ctx context.Context, st *streamState, ev wireEvent) (isDone bool, err error) {
	if isTerminal(ev.Type) {
		return true, a.finishTurn(ctx, st, ev)
	}
	// A failed emit must NOT end the turn: the worker is still executing, and
	// concluding here made driveTurn post a completed durable final for a turn
	// that was mid-tool, release the worker, and let the idle reaper kill it
	// while it worked. The app's sink absorbs push failures and reconnects on
	// its own, so an emit "failure" is only a dropped live frame — keep
	// consuming to the real terminal; the durable fold stays complete.
	_ = st.apply(ev)
	return false, nil
}

// finishTurn maps the terminal event per the table on Stream.
func (a *Agent) finishTurn(ctx context.Context, st *streamState, ev wireEvent) error {
	switch ev.Type {
	case eventHandoff:
		if f, mErr := frames.Handoff(ev.Seed); mErr == nil {
			_ = st.emit(f)
		}
		return domain.ErrTurnHandedOff
	default: // turn_done
		if ev.Outcome == outcomeError {
			msg := ev.ErrorMessage
			if msg == "" {
				msg = "the agent hit an error"
			}
			// agent_error is the KNOWN state; the wrapper's prose is unknown
			// content and rides as a wrapped plain-error reason, visible in
			// the manager's log, collapsed to "unknown" by herr.Body if it ever
			// hit a wire. app.Chat composes the vetted wire herr.
			return herr.NewLight(ctx, domain.ErrAgentError, nil, errors.New(msg))
		}
		// ok and aborted both settle clean here; the control plane's own
		// terminal (final vs stopped) is first-writer-wins upstream.
		return nil
	}
}

// streamState maps non-terminal wire events onto frames: the answer/reasoning
// deltas (with the paragraph restore opencode applies when text resumes after
// a tool call), the tool lifecycle through the shared toolmap tracker, and the
// plan snapshots.
type streamState struct {
	emit           func(frames.Frame) bool
	tools          *toolmap.ToolCallTracker
	hasEmittedText bool
	isAfterTool    bool
	startedInput   map[string]json.RawMessage
}

func newStreamState(emit func(frames.Frame) bool) *streamState {
	return &streamState{
		emit:         emit,
		tools:        toolmap.NewToolCallTracker(),
		startedInput: map[string]json.RawMessage{},
	}
}

// apply emits the frames one wire event maps to. Reports false when the relay
// push broke (an emit failed), which ends the stream.
func (s *streamState) apply(ev wireEvent) bool {
	switch ev.Type {
	case eventDelta:
		if ev.Text == "" {
			return true
		}
		text := ev.Text
		// Text resuming AFTER a tool call is a new message segment, but the
		// deltas carry no boundary: everything downstream concatenates them
		// into one string. Restore the paragraph the model actually produced
		// (opencode parity).
		if s.hasEmittedText && s.isAfterTool {
			text = "\n\n" + text
		}
		s.hasEmittedText = true
		s.isAfterTool = false
		f, mErr := frames.Delta(text)
		if mErr != nil {
			return true
		}
		return s.emit(f)
	case eventReasoning:
		if ev.Text == "" {
			return true
		}
		f, mErr := frames.Reasoning(ev.Text)
		if mErr != nil {
			return true
		}
		return s.emit(f)
	case eventToolStart:
		return s.applyToolStart(ev)
	case eventToolEnd:
		return s.applyToolEnd(ev)
	case eventPlan:
		return s.applyPlan(ev)
	}
	// turn_started, tool_update, and anything a newer wrapper adds: no frame.
	return true
}

func (s *streamState) applyToolStart(ev wireEvent) bool {
	if ev.ID == "" || ev.Name == "" {
		return true
	}
	if !s.tools.StartIfNew(ev.ID) {
		return true
	}
	input := toolmap.RawToolValue(ev.Input)
	// Only a tool end deletes its entry, so a turn that opens calls the wrapper
	// never settles would hold every raw input for the turn's whole life. The
	// cap drops the oldest recorded inputs instead.
	if len(s.startedInput) >= maxStartedInputs {
		for id := range s.startedInput {
			delete(s.startedInput, id)
			if len(s.startedInput) < maxStartedInputs {
				break
			}
		}
	}
	s.startedInput[ev.ID] = input
	f, mErr := frames.ToolStart(ev.ID, ev.Name, "", "", input)
	if mErr != nil {
		return true
	}
	s.isAfterTool = true
	return s.emit(f)
}

func (s *streamState) applyToolEnd(ev wireEvent) bool {
	if ev.ID == "" || ev.Name == "" {
		return true
	}
	input := toolmap.RawToolValue(ev.Input)
	if input == nil {
		// pi's end event replays the start's args (PROTOCOL.md); if a shape
		// ever omits them, the recorded start input keeps the settle event
		// self-describing.
		input = s.startedInput[ev.ID]
	}
	// A fast tool whose start was never surfaced still opens its card first,
	// so the consumer is never asked to close a card it was never told to open.
	if s.tools.StartIfNew(ev.ID) {
		if f, mErr := frames.ToolStart(ev.ID, ev.Name, "", "", input); mErr == nil {
			s.isAfterTool = true
			if !s.emit(f) {
				return false
			}
		}
	}
	if !s.tools.EndIfNew(ev.ID, ev.Name) {
		return true
	}
	delete(s.startedInput, ev.ID)
	output := toolmap.TruncateToolOutput(ev.Output)
	f, mErr := frames.ToolEnd(ev.ID, ev.Name, input, ev.IsError, output, 0)
	if mErr != nil {
		return true
	}
	s.isAfterTool = true
	return s.emit(f)
}

// applyPlan mirrors the wrapper's plan snapshot (emitted on every successful
// todowrite) as the typed plan frame, plus the measured X/Y progress sample
// when the plan speaks that protocol.
func (s *streamState) applyPlan(ev wireEvent) bool {
	items := make([]frames.PlanItem, 0, len(ev.Items))
	for _, item := range ev.Items {
		items = append(items, frames.PlanItem{Content: item.Content, Status: item.Status})
	}
	bounded, ok := toolmap.BoundPlanItems(items)
	if !ok {
		return true
	}
	if f, mErr := frames.Plan(bounded); mErr == nil {
		s.isAfterTool = true
		if !s.emit(f) {
			return false
		}
	}
	if f, ok := s.tools.MeasuredProgressFromPlan(bounded); ok {
		if !s.emit(f) {
			return false
		}
	}
	return true
}

// NotifyShutdownImminent (ADR-048) tells the wrapper the manager will kill the
// process by deadline; an in-flight turn then terminates with a handoff event
// carrying the conversation digest.
func (a *Agent) NotifyShutdownImminent(ctx context.Context, _ string, deadline time.Time) error {
	return a.writeCommand(ctx, command{Type: "shutdown_imminent", DeadlineMs: deadline.UnixMilli()})
}

// AbortTurn is the optional app.TurnAborter capability: it writes abort for
// exactly the named turn. The wrapper double-checks the id against its running
// turn, so a stale cancel can never halt the wrong generation. The aborted
// turn still terminates with turn_done aborted, which Stream settles clean.
func (a *Agent) AbortTurn(ctx context.Context, _ string, turnID string) error {
	if turnID == "" {
		return errors.New("pi agent: abort needs a turn id")
	}
	return a.writeCommand(ctx, command{Type: "abort", TurnID: turnID})
}

// commandWriteTimeout bounds one command write when the caller's context sets
// no earlier deadline. A worker that has stopped reading its stdin fills the
// pipe buffer, and an unbounded write there holds pipesMu forever: Post,
// AbortTurn, NotifyShutdownImminent and currentReader all take that lock, so
// one wedged worker would wedge the cancel path for its whole conversation.
const commandWriteTimeout = 5 * time.Second

// deadlineWriter is the write end of the wrapper's stdin pipe. os.Pipe files
// are runtime-poller backed, so a write deadline actually interrupts a write
// blocked on a full pipe.
type deadlineWriter interface {
	SetWriteDeadline(t time.Time) error
}

// writeCommand writes one JSONL command line to the wrapper's stdin, whole
// lines under the stdin mutex so concurrent writers never interleave. The write
// is deadline-bounded (see commandWriteTimeout).
//
// A write that fails part-way has put a partial line on the wire, and the
// wrapper's reader splits on newlines: the next command would concatenate onto
// that fragment and both would be unparseable. So a failed write POISONS the
// pipe — every later command is refused with the same error, and the pool
// recycles the worker on the turn failure that follows.
func (a *Agent) writeCommand(ctx context.Context, cmd command) error {
	body, err := json.Marshal(cmd)
	if err != nil {
		return fmt.Errorf("pi agent: marshal %s command: %w", cmd.Type, err)
	}
	deadline := time.Now().Add(commandWriteTimeout)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}

	a.pipesMu.Lock()
	defer a.pipesMu.Unlock()
	if a.stdin == nil {
		return errWorkerGone(ctx, "worker stdin not open")
	}
	if a.stdinBroken {
		return errWorkerGone(ctx, "worker stdin is broken, an earlier command did not write whole")
	}
	if pipe, ok := any(a.stdin).(deadlineWriter); ok {
		if err := pipe.SetWriteDeadline(deadline); err == nil {
			defer func() { _ = pipe.SetWriteDeadline(time.Time{}) }()
		}
	}
	if _, err := a.stdin.Write(append(body, '\n')); err != nil {
		a.stdinBroken = true
		return errWorkerGone(ctx, fmt.Sprintf("write %s command: %v", cmd.Type, err))
	}
	return nil
}

// errWorkerGone reports that this worker can never serve another turn, in the
// one shape the app recycles on.
//
// The pipe IS the session here: pi has no remote session to look up, so the
// wrapper being unreachable is the whole of "the session vanished". Every
// caller of this reaches it only after the worker is structurally unusable —
// stdin never opened, or poisoned by a partial write that no later command can
// be appended to safely.
//
// Returning domain.ErrSessionNotFound is what makes the comment on
// writeCommand true. app.go recycles the conversation's worker on exactly this
// code and falls through to a generic post failure on anything else, and a
// generic failure leaves the dead worker in the pool for the next turn to find.
// Under the opencode harness this code was raised by an HTTP 404 on a vanished
// session; ADR-131 removed that harness, and without this the recovery path
// would have had no producer left.
func errWorkerGone(ctx context.Context, detail string) error {
	return herr.New(ctx, domain.ErrSessionNotFound, herr.M{
		"message": "the assistant session ended, please try again",
		"detail":  "pi agent: " + detail,
	})
}

// randomID returns a short random hex handle (session ids, private turn ids).
func randomID() string {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		// A broken crypto/rand is a broken host; fall back to a fixed marker
		// rather than failing turn plumbing over a cosmetic id.
		return "00000000"
	}
	return hex.EncodeToString(raw)
}

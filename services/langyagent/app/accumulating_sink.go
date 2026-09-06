package app

import (
	"sync"
	"time"

	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
	"github.com/langwatch/langwatch/services/langyagent/internal/turnfold"
)

// reopenCooldown rate-limits relay reconnect attempts after a push failure, so
// a control plane that is briefly down is not hammered once per frame. Between
// attempts the sink stays deaf: frames keep folding into the accumulator and
// the live edge is simply missing, which is the same degraded mode as a turn
// with the relay disabled.
const reopenCooldown = 5 * time.Second

// frameSink is the app's ChatSink for a self-driven turn: every frame the coding
// agent produces is (1) folded into a turnfold.Accumulator so the app can post a
// self-sufficient durable final, and (2) pushed to the control-plane relay via the
// per-turn FrameStream. The stream may be nil (relay disabled — an older control
// plane with no runToken, or a missing endpoint): the turn still runs and
// finalizes, it just has no live edge.
//
// Emit NEVER surfaces a push failure (the ChatSink contract: a dropped
// ephemeral frame must never fail the turn). A broken push instead flips the
// sink into reconnect mode: the dead stream is closed, and later Emits retry
// `reopen` at most once per reopenCooldown until a fresh stream takes. The
// worker meanwhile keeps running its turn to the real terminal — ending the
// turn on a push failure is what used to post a completed durable final for a
// turn that was still mid-tool, release the worker, and let the idle reaper
// kill it while it worked.
type frameSink struct {
	acc *turnfold.Accumulator

	// mu serializes pushes and stream swaps; the fold has its own lock.
	mu           sync.Mutex
	stream       FrameStream
	reopen       func() FrameStream
	nextReopenAt time.Time

	// now reads the clock the cooldown is measured against. Injectable so a
	// test states where in the cooldown each push lands, instead of depending
	// on a burst of pushes finishing inside reopenCooldown.
	now func() time.Time

	// onFirstFrame, when set, fires exactly once on the first Emit — the moment the
	// agent produces its first output (time-to-first-token). driveTurn wires it to a
	// span event so the turn trace shows how long the worker sat before it spoke.
	firstFrame   sync.Once
	onFirstFrame func()

	// onFrame, when set, observes EVERY emitted frame, after the accumulate
	// AND after the push. Inspect-only: it cannot veto or fail the emit.
	// driveTurn wires the GitHub gate here so it can watch the tool stream for
	// the agent reaching for a capability the turn doesn't carry (see
	// githubgate.go). Observing after the push matters: the gate's trip
	// cancels the stream context, and observing first canceled the push of
	// the very tool card that tripped it, so the user saw the gate's verdict
	// with no trace of the command it judged.
	onFrame func(frames.Frame)
}

// newFrameSink builds the sink over the turn's initial relay stream, on the
// real clock. reopen, when non-nil, is how the sink gets a replacement stream
// after a push failure; it must be cheap to call and may return nil (relay
// still unreachable).
func newFrameSink(stream FrameStream, reopen func() FrameStream) *frameSink {
	return newFrameSinkWithClock(stream, reopen, time.Now)
}

// newFrameSinkWithClock builds the sink on an injected clock (tests).
func newFrameSinkWithClock(stream FrameStream, reopen func() FrameStream, now func() time.Time) *frameSink {
	return &frameSink{stream: stream, reopen: reopen, acc: turnfold.New(), now: now}
}

// Emit folds the frame into the durable-final accumulator and pushes it to the
// relay. The accumulate always happens first, so the durable final is complete
// regardless of the push; a push failure is absorbed (see the type comment) and
// never returned to the caller.
func (s *frameSink) Emit(f frames.Frame) error {
	if s.onFirstFrame != nil {
		s.firstFrame.Do(s.onFirstFrame)
	}
	s.acc.Observe(f)
	s.push(f)
	if s.onFrame != nil {
		s.onFrame(f)
	}
	return nil
}

func (s *frameSink) push(f frames.Frame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stream == nil {
		s.tryReopenLocked()
	}
	if s.stream == nil {
		return
	}
	if err := s.stream.Emit(f); err != nil {
		_ = s.stream.Close()
		s.stream = nil
		// One immediate reconnect attempt: a control-plane restart drops the
		// push connection but accepts a new one right away, and retrying now
		// loses no frames. The cooldown only applies to attempts AFTER a
		// failed reopen, so a healthy relay heals on the very next frame.
		s.tryReopenLocked()
		if s.stream != nil {
			if err := s.stream.Emit(f); err != nil {
				_ = s.stream.Close()
				s.stream = nil
				s.nextReopenAt = s.now().Add(reopenCooldown)
			}
		}
	}
}

// tryReopenLocked attempts one relay reconnect, respecting the cooldown.
// Caller holds s.mu.
func (s *frameSink) tryReopenLocked() {
	if s.reopen == nil || s.now().Before(s.nextReopenAt) {
		return
	}
	s.stream = s.reopen()
	if s.stream == nil {
		s.nextReopenAt = s.now().Add(reopenCooldown)
	}
}

// Close ends whatever stream the sink currently holds (the original, or a
// reconnect's replacement). driveTurn defers this, so the sink owns stream
// lifetime once constructed.
func (s *frameSink) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stream != nil {
		_ = s.stream.Close()
		s.stream = nil
	}
	// No more reopens after Close: the turn is over.
	s.reopen = nil
}

// result snapshots the accumulated final, mapping the frame-shaped tool calls
// turnfold returns to the durable-final shape the control-plane ingest expects
// (FinalToolCall). Called once, after the stream has returned.
func (s *frameSink) result() (text string, toolCalls []FinalToolCall) {
	text, tools := s.acc.Result()
	toolCalls = make([]FinalToolCall, 0, len(tools))
	for _, t := range tools {
		toolCalls = append(toolCalls, FinalToolCall{
			ID:      t.ID,
			Name:    t.Name,
			Input:   t.Input,
			Output:  t.Output,
			IsError: t.IsError,
		})
	}
	return text, toolCalls
}

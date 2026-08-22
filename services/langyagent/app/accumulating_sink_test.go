package app

import (
	"encoding/json"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// captureStream records frames pushed to the relay, so the test can assert the
// frameSink both pushes each frame in order AND accumulates the durable final.
type captureStream struct {
	emitted []frames.Frame
	closed  bool
}

func (s *captureStream) Emit(f frames.Frame) error { s.emitted = append(s.emitted, f); return nil }
func (s *captureStream) Close() error              { s.closed = true; return nil }

// okf unwraps a frames.* constructor's (Frame, error) so it spreads as one arg.
func okf(f frames.Frame, err error) frames.Frame {
	if err != nil {
		panic(err)
	}
	return f
}

// The frame an onFrame observer trips on is still delivered: the GitHub gate
// cancels the stream context from inside its Observe, and when observation ran
// before the push, that cancellation killed the push of the very tool card
// the gate judged — the user saw the gate's verdict with no trace of the
// command behind it.
func TestFrameSink_ObserverSeesFrameOnlyAfterPush(t *testing.T) {
	stream := &captureStream{}
	sink := newFrameSink(stream, nil)

	pushedWhenObserved := -1
	sink.onFrame = func(frames.Frame) { pushedWhenObserved = len(stream.emitted) }

	if err := sink.Emit(okf(frames.ToolEnd("a", "bash", nil, true, "gh: not logged in", 0))); err != nil {
		t.Fatalf("emit: %v", err)
	}
	if pushedWhenObserved != 1 {
		t.Fatalf("observer ran with %d frames pushed, want 1 (push must precede observation)", pushedWhenObserved)
	}
}

func TestFrameSink_PushesAndAccumulates(t *testing.T) {
	stream := &captureStream{}
	sink := newFrameSink(stream, nil)

	in := []frames.Frame{
		okf(frames.Delta("hi")),
		okf(frames.ToolStart("a", "search", "", "", json.RawMessage(`{"q":"x"}`))),
		okf(frames.ToolEnd("a", "search", nil, false, "found", 0)),
	}
	for _, f := range in {
		if err := sink.Emit(f); err != nil {
			t.Fatalf("emit: %v", err)
		}
	}

	// Every frame is pushed to the relay stream, in order.
	if len(stream.emitted) != len(in) {
		t.Fatalf("pushed %d frames, want %d", len(stream.emitted), len(in))
	}

	// result() maps the accumulated frame-shaped tool call to FinalToolCall.
	text, tools := sink.result()
	if text != "hi" {
		t.Errorf("text = %q, want hi", text)
	}
	if len(tools) != 1 || tools[0].ID != "a" || tools[0].Name != "search" {
		t.Fatalf("tools = %+v, want one FinalToolCall {a,search}", tools)
	}
	if tools[0].Output == nil || *tools[0].Output != "found" {
		t.Errorf("tool output = %v, want found", tools[0].Output)
	}
}

// A nil stream (relay disabled for this turn) must not panic — the durable final
// is still accumulated so the Finalizer backstop can post it.
func TestFrameSink_NilStreamStillAccumulates(t *testing.T) {
	sink := newFrameSink(nil, nil)
	if err := sink.Emit(okf(frames.Delta("hi"))); err != nil {
		t.Fatalf("emit: %v", err)
	}
	if text, _ := sink.result(); text != "hi" {
		t.Errorf("text = %q, want hi", text)
	}
}

// brokenStream fails every push, standing in for a relay connection the control
// plane dropped mid-turn.
type brokenStream struct{ closed bool }

func (s *brokenStream) Emit(frames.Frame) error {
	return errStreamConsumerCrashed
}
func (s *brokenStream) Close() error { s.closed = true; return nil }

// @scenario "A broken relay push never fails the turn"
// The pre-fix behavior: an Emit error propagated out of the sink, the pi
// adapter treated it as the turn's end, driveTurn posted a completed durable
// final for a turn still mid-tool, released the worker, and the idle reaper
// killed the worker while it was executing a 90-second tool call.
func TestFrameSink_PushFailureIsAbsorbedAndReconnects(t *testing.T) {
	broken := &brokenStream{}
	replacement := &captureStream{}
	sink := newFrameSink(broken, func() FrameStream { return replacement })

	// The frame that hits the broken stream is retried on the reopened one, so
	// a control-plane restart loses no frames.
	if err := sink.Emit(okf(frames.Delta("hi"))); err != nil {
		t.Fatalf("emit must absorb the push failure, got: %v", err)
	}
	if !broken.closed {
		t.Error("the broken stream must be closed on push failure")
	}
	if len(replacement.emitted) != 1 {
		t.Fatalf("reopened stream got %d frames, want the failed frame retried once", len(replacement.emitted))
	}

	// Later frames ride the replacement stream directly.
	if err := sink.Emit(okf(frames.Delta(" there"))); err != nil {
		t.Fatalf("emit: %v", err)
	}
	if len(replacement.emitted) != 2 {
		t.Fatalf("reopened stream got %d frames, want 2", len(replacement.emitted))
	}

	// The fold saw every frame regardless of push health.
	if text, _ := sink.result(); text != "hi there" {
		t.Errorf("text = %q, want %q", text, "hi there")
	}
}

// When the reopen also fails, the sink goes deaf under a cooldown instead of
// retrying per frame: frames keep folding, nothing errors, and the turn runs
// to its real terminal with the durable final intact.
func TestFrameSink_ReopenFailureGoesDeafUnderCooldown(t *testing.T) {
	reopens := 0
	sink := newFrameSink(&brokenStream{}, func() FrameStream {
		reopens++
		return nil
	})

	for range 5 {
		if err := sink.Emit(okf(frames.Delta("x"))); err != nil {
			t.Fatalf("emit: %v", err)
		}
	}
	// First failure attempts one immediate reopen; the cooldown then gates the
	// rest of the burst to zero further attempts.
	if reopens != 1 {
		t.Fatalf("reopen attempts = %d, want 1 (cooldown must gate the burst)", reopens)
	}
	if text, _ := sink.result(); text != "xxxxx" {
		t.Errorf("text = %q, want all frames folded", text)
	}
}

// Close ends the current stream and disables reconnects: a finished turn must
// not reopen a relay push from a late frame.
func TestFrameSink_CloseStopsReopens(t *testing.T) {
	reopens := 0
	stream := &captureStream{}
	sink := newFrameSink(stream, func() FrameStream {
		reopens++
		return &captureStream{}
	})
	sink.Close()
	if !stream.closed {
		t.Error("Close must close the held stream")
	}
	if err := sink.Emit(okf(frames.Delta("late"))); err != nil {
		t.Fatalf("emit: %v", err)
	}
	if reopens != 0 {
		t.Errorf("reopen attempts after Close = %d, want 0", reopens)
	}
}

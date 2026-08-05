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

func TestFrameSink_PushesAndAccumulates(t *testing.T) {
	stream := &captureStream{}
	sink := newFrameSink(stream)

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
	sink := newFrameSink(nil)
	if err := sink.Emit(okf(frames.Delta("hi"))); err != nil {
		t.Fatalf("emit: %v", err)
	}
	if text, _ := sink.result(); text != "hi" {
		t.Errorf("text = %q, want hi", text)
	}
}

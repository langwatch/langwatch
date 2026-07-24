package turnfold

import (
	"encoding/json"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// ff unwraps a frames.* constructor's (Frame, error) so it spreads as one arg.
func ff(f frames.Frame, err error) frames.Frame {
	if err != nil {
		panic(err)
	}
	return f
}

func feed(acc *Accumulator, fs ...frames.Frame) {
	for _, f := range fs {
		acc.Observe(f)
	}
}

func TestAccumulator_ConcatenatesDeltaText(t *testing.T) {
	acc := New()
	feed(acc,
		ff(frames.Delta("Hello, ")),
		ff(frames.Heartbeat()), // ephemeral — contributes nothing
		ff(frames.Delta("world")),
	)
	text, tools := acc.Result()
	if text != "Hello, world" {
		t.Errorf("text = %q, want %q", text, "Hello, world")
	}
	if len(tools) != 0 {
		t.Errorf("tools = %+v, want none", tools)
	}
}

func TestAccumulator_AssemblesToolCallsInOrder(t *testing.T) {
	acc := New()
	feed(acc,
		ff(frames.ToolStart("a", "search", "", "", json.RawMessage(`{"q":"x"}`))),
		ff(frames.ToolStart("b", "run", "", "", nil)),
		ff(frames.ToolEnd("a", "search", nil, false, "found", 0)),
		ff(frames.ToolEnd("b", "run", nil, true, "boom", 0)),
		ff(frames.Delta("done")),
	)
	text, tools := acc.Result()
	if text != "done" {
		t.Errorf("text = %q", text)
	}
	if len(tools) != 2 {
		t.Fatalf("tools = %d, want 2", len(tools))
	}
	// First-seen order preserved; the end phase's output/isError win, and the
	// input from the start phase persists.
	if tools[0].ID != "a" || tools[0].Name != "search" {
		t.Errorf("tool[0] = %+v", tools[0])
	}
	if string(tools[0].Input) != `{"q":"x"}` {
		t.Errorf("tool[0].Input = %s", tools[0].Input)
	}
	if tools[0].Output == nil || *tools[0].Output != "found" {
		t.Errorf("tool[0].Output = %v", tools[0].Output)
	}
	if tools[1].ID != "b" || tools[1].IsError == nil || !*tools[1].IsError {
		t.Errorf("tool[1] = %+v", tools[1])
	}
}

func TestAccumulator_IgnoresNonAccumulatingFrames(t *testing.T) {
	acc := New()
	feed(acc,
		ff(frames.ToolStart("", "x", "", "", nil)), // no id — skipped
		ff(frames.Error("boom", "some_code")),      // terminal, no content
		ff(frames.Final("", nil)),                  // terminal, no content
	)
	text, tools := acc.Result()
	if text != "" || len(tools) != 0 {
		t.Errorf("expected empty accumulation, got text=%q tools=%+v", text, tools)
	}
}

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

func TestAccumulator_DropsPreToolNarration(t *testing.T) {
	acc := New()
	feed(acc,
		ff(frames.Delta("Running the analytics query now…")),
		ff(frames.ToolStart("a", "run", "", "", nil)),
		ff(frames.ToolEnd("a", "run", nil, false, "ok", 0)),
		ff(frames.Delta("p95 latency doubled yesterday.")),
	)
	text, _ := acc.Result()
	if text != "p95 latency doubled yesterday." {
		t.Errorf("text = %q, want only the post-tool answer", text)
	}
}

// Whitespace is not an answer. A model that emits a stray newline after its
// last tool call has said nothing, so the fold must treat it the same as
// silence and fall back — otherwise the user's reply becomes "\n  \n".
func TestAccumulator_KeepsFullTextWhenPostToolDeltaIsBlank(t *testing.T) {
	acc := New()
	feed(acc,
		ff(frames.Delta("Annotation added.")),
		ff(frames.ToolStart("a", "annotate", "", "", nil)),
		ff(frames.ToolEnd("a", "annotate", nil, false, "ok", 0)),
		ff(frames.Delta("\n  \n")),
	)
	text, _ := acc.Result()
	if text != "Annotation added." {
		t.Errorf("text = %q, want full concatenation fallback", text)
	}
}

// The post-tool segment usually opens with the newline that separated it from
// the tool call. That leading whitespace is an artifact of the stream, not part
// of the answer, and it renders as a blank line at the top of the reply.
func TestAccumulator_TrimsLeadingWhitespaceFromPostToolAnswer(t *testing.T) {
	acc := New()
	feed(acc,
		ff(frames.ToolStart("a", "run", "", "", nil)),
		ff(frames.ToolEnd("a", "run", nil, false, "ok", 0)),
		ff(frames.Delta("\n\np95 doubled.")),
	)
	text, _ := acc.Result()
	if text != "p95 doubled." {
		t.Errorf("text = %q, want the leading newlines trimmed", text)
	}
}

func TestAccumulator_KeepsFullTextWhenSilentAfterLastTool(t *testing.T) {
	acc := New()
	feed(acc,
		ff(frames.Delta("Annotation added.")),
		ff(frames.ToolStart("a", "annotate", "", "", nil)),
		ff(frames.ToolEnd("a", "annotate", nil, false, "ok", 0)),
	)
	text, _ := acc.Result()
	if text != "Annotation added." {
		t.Errorf("text = %q, want full concatenation fallback", text)
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

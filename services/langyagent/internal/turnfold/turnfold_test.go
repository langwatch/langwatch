package turnfold

import "testing"

func observe(acc *Accumulator, lines ...string) {
	for _, l := range lines {
		acc.Observe([]byte(l + "\n"))
	}
}

func TestAccumulator_ConcatenatesTokenText(t *testing.T) {
	acc := New()
	observe(acc,
		`{"type":"langy.token","text":"Hello, "}`,
		`{"type":"message.part.delta","properties":{"field":"text","delta":"IGNORED verbatim"}}`,
		`{"type":"langy.progress"}`,
		`{"type":"langy.token","text":"world"}`,
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
	observe(acc,
		`{"type":"langy.tool","id":"a","name":"search","phase":"start","input":{"q":"x"}}`,
		`{"type":"langy.tool","id":"b","name":"run","phase":"start"}`,
		`{"type":"langy.tool","id":"a","name":"search","phase":"end","output":"found"}`,
		`{"type":"langy.tool","id":"b","name":"run","phase":"end","output":"boom","isError":true}`,
		`{"type":"langy.token","text":"done"}`,
	)
	text, tools := acc.Result()
	if text != "done" {
		t.Errorf("text = %q", text)
	}
	if len(tools) != 2 {
		t.Fatalf("tools = %d, want 2", len(tools))
	}
	// First-seen order preserved; the end phase's output/isError win.
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

func TestAccumulator_IgnoresMalformedAndUnrelatedLines(t *testing.T) {
	acc := New()
	observe(acc,
		`not json at all`,
		`{"type":"langy.tool"}`, // no id — skipped
		`{"type":"error","error":"boom"}`,
	)
	text, tools := acc.Result()
	if text != "" || len(tools) != 0 {
		t.Errorf("expected empty accumulation, got text=%q tools=%+v", text, tools)
	}
}

package app

import (
	"bytes"
	"testing"
)

// captureSink is a ChatSink that records everything written to it, so the test
// can assert the decorator forwards frames unchanged while accumulating them.
type captureSink struct {
	buf     bytes.Buffer
	begun   bool
	flushed bool
}

func (s *captureSink) Begin()              { s.begun = true }
func (s *captureSink) ErrorEvent(_ string) {}
func (s *captureSink) Flush()              { s.flushed = true }
func (s *captureSink) Write(p []byte) (int, error) {
	return s.buf.Write(p)
}

func TestAccumulatingSink_ForwardsAndAccumulates(t *testing.T) {
	inner := &captureSink{}
	acc := newAccumulatingSink(inner)

	// Embedded ChatSink methods pass through untouched.
	acc.Begin()
	acc.Flush()
	if !inner.begun || !inner.flushed {
		t.Errorf("Begin/Flush not forwarded to inner sink")
	}

	lines := []string{
		`{"type":"langy.token","text":"hi"}`,
		`{"type":"message.part.delta","properties":{"field":"text","delta":"hi"}}`,
		`{"type":"langy.tool","id":"a","name":"search","phase":"end","output":"found","isError":false}`,
	}
	for _, l := range lines {
		if _, err := acc.Write([]byte(l + "\n")); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	// Every line is forwarded verbatim to the inner sink.
	for _, l := range lines {
		if !bytes.Contains(inner.buf.Bytes(), []byte(l)) {
			t.Errorf("inner sink missing forwarded line %q", l)
		}
	}

	// result() maps the accumulated frame-shaped tool call to FinalToolCall.
	text, tools := acc.result()
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

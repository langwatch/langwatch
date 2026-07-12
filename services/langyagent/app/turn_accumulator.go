package app

import (
	"bytes"
	"encoding/json"
	"strings"
	"sync"
)

// accumulatingSink wraps a ChatSink, forwarding every call unchanged while
// parsing the langy.token / langy.tool frames flowing through Write. That lets
// the app assemble a durable final (text + tool calls) to POST independently of
// the relay, without changing the Worker/StreamEvents contract.
//
// Parsing is best-effort: an unrecognised or malformed line is forwarded and
// simply not accumulated — these are the same frames the control plane already
// classifies. A langy.progress heartbeat (no text, no id) contributes nothing.
type accumulatingSink struct {
	inner ChatSink

	mu    sync.Mutex
	text  strings.Builder
	order []string
	tools map[string]*FinalToolCall
}

func newAccumulatingSink(inner ChatSink) *accumulatingSink {
	return &accumulatingSink{inner: inner, tools: map[string]*FinalToolCall{}}
}

func (s *accumulatingSink) Begin()              { s.inner.Begin() }
func (s *accumulatingSink) ErrorEvent(m string) { s.inner.ErrorEvent(m) }
func (s *accumulatingSink) Flush()              { s.inner.Flush() }

func (s *accumulatingSink) Write(p []byte) (int, error) {
	s.observe(p)
	return s.inner.Write(p)
}

// frameEnvelope is the superset of the langy.token / langy.tool wire shapes the
// accumulator reads. It intentionally ignores every other field.
type frameEnvelope struct {
	Type    string          `json:"type"`
	Text    string          `json:"text"`
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input"`
	Output  *string         `json:"output"`
	IsError *bool           `json:"isError"`
}

// langyFrameMarker prefilters the write stream so only the compact
// langy.token / langy.tool frames are parsed — the heavy verbatim opencode
// event lines (the bulk of the stream) are skipped without a full unmarshal.
var langyFrameMarker = []byte("langy.t")

func (s *accumulatingSink) observe(line []byte) {
	if !bytes.Contains(line, langyFrameMarker) {
		return
	}
	var ev frameEnvelope
	if err := json.Unmarshal(line, &ev); err != nil {
		return
	}
	switch ev.Type {
	case "langy.token":
		s.mu.Lock()
		s.text.WriteString(ev.Text)
		s.mu.Unlock()
	case "langy.tool":
		if ev.ID == "" {
			return
		}
		s.mu.Lock()
		call, ok := s.tools[ev.ID]
		if !ok {
			call = &FinalToolCall{ID: ev.ID}
			s.tools[ev.ID] = call
			s.order = append(s.order, ev.ID)
		}
		// Both phases carry name + input; the end phase adds output + isError.
		// Take the latest non-empty values so the end phase wins.
		if ev.Name != "" {
			call.Name = ev.Name
		}
		if len(ev.Input) > 0 {
			call.Input = ev.Input
		}
		if ev.Output != nil {
			call.Output = ev.Output
		}
		if ev.IsError != nil {
			call.IsError = ev.IsError
		}
		s.mu.Unlock()
	}
}

// result snapshots the accumulated final. Called once, after the stream has
// returned, so it observes every frame the turn produced.
func (s *accumulatingSink) result() (text string, toolCalls []FinalToolCall) {
	s.mu.Lock()
	defer s.mu.Unlock()
	calls := make([]FinalToolCall, 0, len(s.order))
	for _, id := range s.order {
		calls = append(calls, *s.tools[id])
	}
	return s.text.String(), calls
}

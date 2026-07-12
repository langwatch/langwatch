// Package turnfold folds a turn's outbound ndjson frame stream into the durable
// final — the assistant text and the tool calls — so the app can POST a
// self-sufficient final independently of the best-effort relay the same bytes
// streamed through. It is the read counterpart to internal/frames (the producer):
// it parses the compact langy.token / langy.tool frames back out of the stream.
package turnfold

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// Accumulator assembles the final from the frames flowing past it. Feed every
// stream line to Observe in order, then read the assembled result once via Result
// after the stream has ended. NOT safe for concurrent use: Observe runs on the
// single stream-consumer goroutine, and Result is called after that goroutine has
// signalled completion (a happens-before, so no lock is needed).
type Accumulator struct {
	text  strings.Builder
	order []string
	tools map[string]*frames.ToolCall
}

// New returns an empty Accumulator.
func New() *Accumulator {
	return &Accumulator{tools: map[string]*frames.ToolCall{}}
}

// marker prefilters the stream: only langy.token / langy.tool frames carry final
// content, so a line without it (the bulk — verbatim opencode events) is skipped
// before paying for a full JSON unmarshal.
var marker = []byte("langy.t")

// frame is the union of the langy.token / langy.tool wire shapes Observe reads;
// every other field on the line is ignored.
type frame struct {
	Type    string          `json:"type"`
	Text    string          `json:"text"`
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input"`
	Output  *string         `json:"output"`
	IsError *bool           `json:"isError"`
}

// Observe folds one ndjson line into the final. Best-effort: an unrecognised or
// malformed line is ignored (these are the same frames the control plane already
// classifies). A langy.token appends its text; a langy.tool upserts the call. A
// heartbeat / progress frame carries neither and contributes nothing.
func (a *Accumulator) Observe(line []byte) {
	if !bytes.Contains(line, marker) {
		return
	}
	var f frame
	if json.Unmarshal(line, &f) != nil {
		return
	}
	switch f.Type {
	case "langy.token":
		a.text.WriteString(f.Text)
	case "langy.tool":
		a.upsertTool(f)
	}
}

// upsertTool merges a tool frame into the call keyed by its id, first-seen order
// preserved. A tool streams as two phases (start, then end); the end phase adds
// output + isError, so taking the latest non-empty value lets it win.
func (a *Accumulator) upsertTool(f frame) {
	if f.ID == "" {
		return
	}
	call, ok := a.tools[f.ID]
	if !ok {
		call = &frames.ToolCall{ID: f.ID}
		a.tools[f.ID] = call
		a.order = append(a.order, f.ID)
	}
	if f.Name != "" {
		call.Name = f.Name
	}
	if len(f.Input) > 0 {
		call.Input = f.Input
	}
	if f.Output != nil {
		call.Output = f.Output
	}
	if f.IsError != nil {
		call.IsError = f.IsError
	}
}

// Result snapshots the accumulated final in stream order. Call once, after the
// stream has returned, so it observes every frame the turn produced.
func (a *Accumulator) Result() (text string, tools []frames.ToolCall) {
	tools = make([]frames.ToolCall, 0, len(a.order))
	for _, id := range a.order {
		tools = append(tools, *a.tools[id])
	}
	return a.text.String(), tools
}

// Package turnfold folds a turn's outbound frame stream into the durable final —
// the assistant text and the tool calls — so the app can POST a self-sufficient
// final independently of the best-effort relay the same frames streamed through.
// It is the read counterpart to internal/frames (the producer): it folds the
// SAME typed frames.Frame values (delta / tool) the manager signs and pushes, so
// there is one frame vocabulary end to end.
package turnfold

import (
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
	// afterTools holds only the delta text seen since the most recent tool
	// frame. When the turn ran tools, this trailing segment is the answer and
	// anything before it is pre-command narration ("Running the query now…"),
	// so Result prefers it. Reset on every tool frame; empty when no tool ran.
	afterTools strings.Builder
	sawTool    bool
}

// New returns an empty Accumulator.
func New() *Accumulator {
	return &Accumulator{tools: map[string]*frames.ToolCall{}}
}

// frame is the union of the delta / tool wire shapes Observe reads; every other
// field on the frame is ignored.
type frame struct {
	Type    string          `json:"type"`
	Text    string          `json:"text"`
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input"`
	Output  *string         `json:"output"`
	IsError *bool           `json:"isError"`
}

// Observe folds one output frame into the final. Best-effort: an unrecognised or
// malformed frame is ignored. A `delta` appends its text; a `tool` upserts the
// call. Ephemeral frames (status / progress / heartbeat / card) and the terminal
// frames (final / error / handoff) carry no accumulation content and are skipped.
func (a *Accumulator) Observe(fr frames.Frame) {
	var f frame
	if json.Unmarshal([]byte(fr.JSON()), &f) != nil {
		return
	}
	switch f.Type {
	case "delta":
		a.text.WriteString(f.Text)
		a.afterTools.WriteString(f.Text)
	case "tool":
		a.upsertTool(f)
		a.afterTools.Reset()
		a.sawTool = true
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
//
// Text selection: when the turn ran tools AND emitted text after the last tool
// frame, only that trailing text is the final — text emitted before/between
// tool calls is status narration, not the answer (the cards already record what
// ran). When the model stays silent after its last tool (e.g. a write where the
// card is the record) or ran no tools at all, the full concatenation is kept so
// nothing visible is lost.
func (a *Accumulator) Result() (text string, tools []frames.ToolCall) {
	tools = make([]frames.ToolCall, 0, len(a.order))
	for _, id := range a.order {
		tools = append(tools, *a.tools[id])
	}
	text = a.text.String()
	if a.sawTool {
		if trailing := a.afterTools.String(); strings.TrimSpace(trailing) != "" {
			text = trailing
		}
	}
	// Trimmed on both ends, on both paths. The post-tool segment almost always
	// opens with the newline that separated it from the tool call, and a model
	// that goes quiet after its last tool can still emit a stray trailing one —
	// neither is part of the answer, and both render as blank lines in the
	// user's panel.
	return strings.TrimSpace(text), tools
}

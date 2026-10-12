package scenario

import (
	"encoding/json"
	"math"
	"slices"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/langwatch/scenario/go/internal/jsjson"
	"github.com/langwatch/scenario/go/internal/spandigest"
)

// ToolCallSource says where a RunToolCall came from.
type ToolCallSource string

// Tool call sources.
const (
	ToolCallFromMessage ToolCallSource = "message"
	ToolCallFromSpan    ToolCallSource = "span"
)

// RunToolCall is one call of a tool during the run.
type RunToolCall struct {
	Name string
	// Input is the call arguments: decoded JSON for message calls, the raw
	// attribute value for span calls.
	Input any
	// Output is the result when known.
	Output any
	// Turn is the index of the call's turn in Turns, or -1 when unknown.
	Turn   int
	Source ToolCallSource

	traceID   string
	canonical string
}

// ToolCalls are the calls of a tool in start order.
type ToolCalls []RunToolCall

// First returns the first call.
func (t ToolCalls) First() (RunToolCall, bool) {
	if len(t) == 0 {
		return RunToolCall{}, false
	}
	return t[0], true
}

// Last returns the last call.
func (t ToolCalls) Last() (RunToolCall, bool) {
	if len(t) == 0 {
		return RunToolCall{}, false
	}
	return t[len(t)-1], true
}

// Inputs returns the input of every call.
func (t ToolCalls) Inputs() []any {
	out := make([]any, len(t))
	for i := range t {
		out[i] = t[i].Input
	}
	return out
}

// Outputs returns the output of every call.
func (t ToolCalls) Outputs() []any {
	out := make([]any, len(t))
	for i := range t {
		out[i] = t[i].Output
	}
	return out
}

// TraceView is one trace of the run.
type TraceView struct {
	ID    string
	state *ExecutionState
	msgs  []Message
	all   []Message
	spans []sdktrace.ReadOnlySpan
}

// Spans returns the spans of the trace collected so far, in start order.
func (t TraceView) Spans() []sdktrace.ReadOnlySpan {
	t.state.noteTrace()
	return spandigest.SortByStartTime(spansOfTrace(t.spans, t.ID))
}

// ToolCalls returns the tool calls of the trace, optionally of one tool.
func (t TraceView) ToolCalls(name ...string) ToolCalls {
	return t.state.collectToolCalls(t.msgs, spansOfTrace(t.spans, t.ID), t.all, name)
}

// TurnView is one turn of the run.
type TurnView struct {
	Index    int
	Messages []Message
	state    *ExecutionState
	all      []Message
	spans    []sdktrace.ReadOnlySpan
}

// Trace returns the trace of the turn, when its messages carry a trace id.
func (t TurnView) Trace() (TraceView, bool) {
	ids := messageTraceIDs(t.Messages)
	if len(ids) == 0 {
		return TraceView{}, false
	}
	return t.state.traceView(ids[0], t.all, t.spans), true
}

// ToolCalls returns the tool calls of the turn, optionally of one tool.
func (t TurnView) ToolCalls(name ...string) ToolCalls {
	ids := messageTraceIDs(t.Messages)
	var spans []sdktrace.ReadOnlySpan
	for _, s := range t.spans {
		if slices.Contains(ids, s.SpanContext().TraceID().String()) {
			spans = append(spans, s)
		}
	}
	return t.state.collectToolCalls(t.Messages, spans, t.all, name)
}

// ToolCalls returns every tool call of the run so far, merged from the
// assistant messages and the tool spans, optionally of one tool.
func (s *ExecutionState) ToolCalls(name ...string) ToolCalls {
	msgs := s.Messages()
	return s.collectToolCalls(msgs, s.spans(), msgs, name)
}

// Spans returns every span of the run collected so far, in start order.
// Never fetches remote traces.
func (s *ExecutionState) Spans() []sdktrace.ReadOnlySpan {
	s.noteTrace()
	return spandigest.SortByStartTime(s.spans())
}

// Traces returns one view per trace id the messages carry, in first-seen
// order.
func (s *ExecutionState) Traces() []TraceView {
	s.noteTrace()
	msgs := s.Messages()
	spans := s.spans()
	ids := messageTraceIDs(msgs)
	out := make([]TraceView, len(ids))
	for i, id := range ids {
		out[i] = s.traceView(id, msgs, spans)
	}
	return out
}

func (s *ExecutionState) traceView(id string, all []Message, spans []sdktrace.ReadOnlySpan) TraceView {
	var msgs []Message
	for _, m := range all {
		if m.TraceID == id {
			msgs = append(msgs, m)
		}
	}
	return TraceView{ID: id, state: s, msgs: msgs, all: all, spans: spans}
}

// Turns returns one view per turn, from the turn stamps on the messages.
func (s *ExecutionState) Turns() []TurnView {
	msgs := s.Messages()
	spans := s.spans()
	turnOf := turnIndexes(msgs)
	var out []TurnView
	for i, m := range msgs {
		idx := turnOf[i]
		for len(out) <= idx {
			out = append(out, TurnView{Index: len(out), state: s, all: msgs, spans: spans})
		}
		out[idx].Messages = append(out[idx].Messages, m)
	}
	return out
}

// Contexts returns every chunk the agent retrieved, from the rag spans.
func (s *ExecutionState) Contexts() []string {
	s.noteTrace()
	out := spanContexts(s.spans())
	if len(out) == 0 {
		s.note(func(r *StateReads) { r.EmptyContexts = true })
	}
	return out
}

func spansOfTrace(spans []sdktrace.ReadOnlySpan, id string) []sdktrace.ReadOnlySpan {
	var out []sdktrace.ReadOnlySpan
	for _, s := range spans {
		if s.SpanContext().TraceID().String() == id {
			out = append(out, s)
		}
	}
	return out
}

// MessageTraceIDs returns the distinct trace ids the messages carry, in
// first-seen order, skipping the all-zero id of a non-recording tracer.
func MessageTraceIDs(msgs []Message) []string { return messageTraceIDs(msgs) }

func messageTraceIDs(msgs []Message) []string {
	var ids []string
	for _, m := range msgs {
		if m.TraceID != "" && m.TraceID != invalidTraceID && !slices.Contains(ids, m.TraceID) {
			ids = append(ids, m.TraceID)
		}
	}
	return ids
}

// turnIndexes maps every message to its position in Turns: distinct turn
// stamps in first-seen order.
func turnIndexes(msgs []Message) []int {
	out := make([]int, len(msgs))
	var stamps []int
	for i, m := range msgs {
		pos := slices.Index(stamps, m.Turn)
		if pos < 0 {
			stamps = append(stamps, m.Turn)
			pos = len(stamps) - 1
		}
		out[i] = pos
	}
	return out
}

func turnOfTraces(all []Message) map[string]int {
	idx := turnIndexes(all)
	out := map[string]int{}
	for i, m := range all {
		if _, seen := out[m.TraceID]; m.TraceID != "" && !seen {
			out[m.TraceID] = idx[i]
		}
	}
	return out
}

var (
	contextAttributes = [...]attribute.Key{"langwatch.rag_contexts", "langwatch.rag.contexts", "retrieval.documents"}
	inputAttributes   = [...]attribute.Key{"langwatch.input", "gen_ai.tool.call.arguments"}
	outputAttributes  = [...]attribute.Key{"langwatch.output", "gen_ai.tool.call.result"}
)

func spanAttribute(s sdktrace.ReadOnlySpan, keys ...attribute.Key) (attribute.Value, bool) {
	attrs := s.Attributes()
	for _, k := range keys {
		for _, kv := range attrs {
			if kv.Key == k {
				return kv.Value, true
			}
		}
	}
	return attribute.Value{}, false
}

func attributeAny(v attribute.Value) any {
	if v.Type() == attribute.INVALID {
		return nil
	}
	return v.AsInterface()
}

// collectToolCalls merges message and span tool calls like the JS
// mergeToolCalls: a span describing a call a message already carries fills
// in its output instead of being listed twice; calls are ordered by turn,
// message calls before span calls.
func (s *ExecutionState) collectToolCalls(msgs []Message, spans []sdktrace.ReadOnlySpan, all []Message, name []string) ToolCalls {
	s.noteTrace()
	turnIdx := turnIndexes(all)
	turnOfID := make(map[string]int, len(all))
	for i, m := range all {
		turnOfID[m.ID] = turnIdx[i]
	}
	outputs := map[string]any{}
	for _, m := range msgs {
		if m.Role == RoleTool {
			outputs[m.ToolCallID] = decodeToolOutput(m.Text())
		}
	}
	var merged ToolCalls
	for _, m := range msgs {
		if m.Role != RoleAssistant {
			continue
		}
		turn, ok := turnOfID[m.ID]
		if !ok {
			turn = -1
		}
		for _, tc := range m.ToolCalls {
			merged = append(merged, RunToolCall{
				Name: tc.Name, Input: decodeJSON(tc.Arguments), Output: outputs[tc.ID],
				Turn: turn, Source: ToolCallFromMessage, traceID: m.TraceID,
				canonical: jsjson.Compact(tc.Arguments),
			})
		}
	}
	nMessage := len(merged)
	described := make([]bool, nMessage)
	traceTurn := turnOfTraces(all)
	for _, sp := range spandigest.SortByStartTime(spans) {
		if v, ok := spanAttribute(sp, "langwatch.span.type"); !ok || v.AsString() != "tool" {
			continue
		}
		callName := sp.Name()
		if v, ok := spanAttribute(sp, "gen_ai.tool.name"); ok {
			callName = v.Emit()
		}
		traceID := sp.SpanContext().TraceID().String()
		turn, ok := traceTurn[traceID]
		if !ok {
			turn = -1
		}
		in, _ := spanAttribute(sp, inputAttributes[:]...)
		out, hasOut := spanAttribute(sp, outputAttributes[:]...)
		call := RunToolCall{Name: callName, Input: attributeAny(in), Turn: turn, Source: ToolCallFromSpan, traceID: traceID}
		if hasOut {
			call.Output = attributeAny(out)
		}
		call.canonical = canonicalValue(call.Input)
		twin := -1
		for i := 0; i < nMessage; i++ {
			if !described[i] && sameCall(merged[i], call) {
				twin = i
				break
			}
		}
		if twin >= 0 {
			described[twin] = true
			if merged[twin].Output == nil && call.Output != nil {
				merged[twin].Output = call.Output
			}
			continue
		}
		merged = append(merged, call)
	}
	rank := func(c RunToolCall) int {
		if c.Turn < 0 {
			return math.MaxInt
		}
		return c.Turn
	}
	slices.SortStableFunc(merged, func(a, b RunToolCall) int {
		if d := rank(a) - rank(b); d != 0 {
			if d < 0 {
				return -1
			}
			return 1
		}
		return sourceRank(a.Source) - sourceRank(b.Source)
	})
	if len(name) > 0 {
		filtered := merged[:0]
		for _, c := range merged {
			if c.Name == name[0] {
				filtered = append(filtered, c)
			}
		}
		merged = filtered
		if len(merged) == 0 {
			s.noteMissingToolCall(name[0])
		}
	}
	if merged == nil {
		merged = ToolCalls{}
	}
	return merged
}

func sourceRank(s ToolCallSource) int {
	if s == ToolCallFromSpan {
		return 1
	}
	return 0
}

func sameCall(a, b RunToolCall) bool {
	if a.Name != b.Name {
		return false
	}
	if a.Turn >= 0 && b.Turn >= 0 && a.Turn != b.Turn {
		return false
	}
	return a.canonical == b.canonical
}

func canonicalValue(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return jsjson.Compact(x)
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return jsjson.Compact(string(b))
}

func decodeJSON(s string) any {
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return s
	}
	return v
}

func decodeToolOutput(content string) any {
	if _, ok := toolOutputJSON(content); ok {
		return decodeJSON(content)
	}
	return content
}

// spanContexts returns the retrieved contexts of every rag span.
func spanContexts(spans []sdktrace.ReadOnlySpan) []string {
	var out []string
	for _, sp := range spandigest.SortByStartTime(spans) {
		v, ok := spanAttribute(sp, contextAttributes[:]...)
		if !ok {
			continue
		}
		var parsed any = attributeAny(v)
		if str, isStr := parsed.(string); isStr {
			if p, err := jsjson.Parse(str); err == nil {
				parsed = p
			}
		}
		items, isList := parsed.([]any)
		if !isList {
			out = append(out, stringifyValue(parsed))
			continue
		}
		for _, item := range items {
			if obj, isObj := item.(jsjson.Object); isObj {
				if c, has := obj.Get("content"); has {
					out = append(out, stringifyValue(c))
					continue
				}
			}
			out = append(out, stringifyValue(item))
		}
	}
	return out
}

func stringifyValue(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case []string:
		return jsjson.Stringify(x)
	}
	return jsjson.Stringify(v)
}

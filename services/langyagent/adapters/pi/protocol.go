// Package pi drives a langy-worker subprocess, the TypeScript wrapper
// embedding the pi coding agent, over the stdio JSONL protocol documented in
// services/langyworker/PROTOCOL.md. It is the only coding-agent adapter since
// ADR-131: the pool provisions + spawns through it, and the app drives each
// turn through the app.CodingAgent port it implements.
package pi

import "encoding/json"

// protocolVersion is the wire version this manager speaks. The wrapper
// announces its own in the ready event; version 1 is the only one that exists.
const protocolVersion = 1

// command is a manager -> wrapper line. One struct covers all four command
// types; omitempty keeps each wire line minimal. Field names match
// services/langyworker/src/protocol.ts exactly.
type command struct {
	Type        string `json:"type"`
	TurnID      string `json:"turnId,omitempty"`
	Prompt      string `json:"prompt,omitempty"`
	System      string `json:"system,omitempty"`
	ResumeToken string `json:"resumeToken,omitempty"`
	DeadlineMs  int64  `json:"deadlineMs,omitempty"`
}

// planItem is one row of a wrapper plan event.
type planItem struct {
	Content string `json:"content"`
	Status  string `json:"status"`
}

// wireEvent is a wrapper -> manager line, decoded typed: every event type's
// fields share this one struct (json.Unmarshal leaves absent fields zero), so
// the reader does a single decode per line with no boxed-any allocation.
type wireEvent struct {
	Type     string `json:"type"`
	Protocol int    `json:"protocol"`
	// ready: whether the wrapper continued a persisted session its home still
	// held. Absent (an older wrapper) decodes false, which keeps the
	// transcript-seed path.
	Resumed bool   `json:"resumed"`
	TurnID  string `json:"turnId"`
	// delta / reasoning
	Text string `json:"text"`
	// tool lifecycle. IDs are opaque strings: the responses lane emits
	// composite ids ("call_...|fc_..."), never parse them.
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input"`
	Output  string          `json:"output"`
	IsError bool            `json:"isError"`
	// plan
	Items []planItem `json:"items"`
	// turn_done
	Outcome      string `json:"outcome"`
	ErrorMessage string `json:"errorMessage"`
	// handoff
	Seed string `json:"seed"`
}

// Event type discriminants (wrapper -> manager).
const (
	eventReady       = "ready"
	eventPong        = "pong"
	eventTurnStarted = "turn_started"
	eventDelta       = "delta"
	eventReasoning   = "reasoning"
	eventToolStart   = "tool_start"
	eventToolUpdate  = "tool_update"
	eventToolEnd     = "tool_end"
	eventPlan        = "plan"
	eventTurnDone    = "turn_done"
	eventHandoff     = "handoff"
)

// turn_done outcomes.
const (
	outcomeOK      = "ok"
	outcomeError   = "error"
	outcomeAborted = "aborted"
)

// isTerminal reports whether an event type closes its turn. PROTOCOL.md
// invariant 1: exactly one terminal per turnId, and nothing follows it.
func isTerminal(t string) bool {
	return t == eventTurnDone || t == eventHandoff
}

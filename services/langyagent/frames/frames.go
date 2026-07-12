// Package frames is the worker's OUTPUT frame producer
// (LANGY_WORKER_REDESIGN_PLAN §0/§0a) — the Go counterpart to the TS relay's
// langyRelayFrame union. The worker emits one typed frame per stream line; each
// frame is JSON-marshalled, then signed with the per-conversation runToken
// (frameauth) so the relay can verify it.
//
// The `type` discriminants and field names here MUST match the TS
// `langyRelayFrame` zod schema exactly — the relay parses the payload against
// it. The union is deliberately open: a new UI card is a new `Card` kind, not a
// new frame type. This is the first package of the wider worker restructure; it
// depends only on frameauth + stdlib.
package frames

import (
	"encoding/json"
	"fmt"

	"github.com/langwatch/langwatch/services/langyagent/frameauth"
)

// Frame is a JSON-marshalled output frame, ready to be signed. Construct one via
// the typed helpers below; the marshalled bytes are what gets signed AND sent
// verbatim, so the relay verifies exactly these bytes.
type Frame struct {
	payload string
}

// JSON returns the marshalled payload string (signed + transmitted verbatim).
func (f Frame) JSON() string { return f.payload }

// Sign marshals nothing further — it signs this frame's payload with the
// per-conversation runToken and the turn identity, minting a fresh frameNonce.
// The returned envelope is the ndjson line the worker writes.
func (f Frame) Sign(runToken string, id frameauth.Identity) (frameauth.Envelope, error) {
	return frameauth.Sign(runToken, id, f.payload)
}

func marshal(v any) (Frame, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return Frame{}, fmt.Errorf("frames: marshal: %w", err)
	}
	return Frame{payload: string(b)}, nil
}

// --- ephemeral frames (live edge only) -------------------------------------

type deltaFrame struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// Delta is a run of assistant prose.
func Delta(text string) (Frame, error) {
	return marshal(deltaFrame{Type: "delta", Text: text})
}

type statusFrame struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

// Status is an ephemeral "major update" — which tool/action the agent is picking.
func Status(status string) (Frame, error) {
	return marshal(statusFrame{Type: "status", Status: status})
}

type progressFrame struct {
	Type     string   `json:"type"`
	Message  string   `json:"message,omitempty"`
	Progress *float64 `json:"progress,omitempty"`
}

// Progress is an ephemeral "sub update". A nil progress omits the field.
func Progress(message string, progress *float64) (Frame, error) {
	return marshal(progressFrame{Type: "progress", Message: message, Progress: progress})
}

type heartbeatFrame struct {
	Type string `json:"type"`
}

// Heartbeat is a content-free keep-alive that refreshes the turn's liveness
// through a long, silent tool call.
func Heartbeat() (Frame, error) {
	return marshal(heartbeatFrame{Type: "heartbeat"})
}

type cardFrame struct {
	Type   string          `json:"type"`
	Kind   string          `json:"kind"`
	Detail string          `json:"detail,omitempty"`
	Data   json.RawMessage `json:"data,omitempty"`
}

// Card is a mid-stream UI card (e.g. "downloading a trace"). `kind` selects the
// renderer; `data` is optional card-specific JSON.
func Card(kind, detail string, data json.RawMessage) (Frame, error) {
	return marshal(cardFrame{Type: "card", Kind: kind, Detail: detail, Data: data})
}

// --- named frame (live card + durable milestone) ---------------------------

type toolFrame struct {
	Type       string          `json:"type"`
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Phase      string          `json:"phase"` // "start" | "end"
	Title      string          `json:"title,omitempty"`
	Command    string          `json:"command,omitempty"`
	Input      json.RawMessage `json:"input,omitempty"`
	Output     string          `json:"output,omitempty"`
	IsError    *bool           `json:"isError,omitempty"`
	DurationMs *int64          `json:"durationMs,omitempty"`
}

// ToolStart announces a tool the agent began running.
func ToolStart(id, name, title, command string, input json.RawMessage) (Frame, error) {
	return marshal(toolFrame{
		Type: "tool", ID: id, Name: name, Phase: "start",
		Title: title, Command: command, Input: input,
	})
}

// ToolEnd reports a tool the agent finished. isError routes the durable
// milestone to tool_call_failed (with output as the error text) vs succeeded.
func ToolEnd(id, name string, isError bool, output string, durationMs int64) (Frame, error) {
	f := toolFrame{Type: "tool", ID: id, Name: name, Phase: "end", Output: output}
	if isError {
		f.IsError = &isError
	}
	if durationMs > 0 {
		f.DurationMs = &durationMs
	}
	return marshal(f)
}

// --- terminal frames (mark the stream end + carry the durable final) --------

// ToolCall is the compact tool-call shape carried on a terminal final frame.
type ToolCall struct {
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input,omitempty"`
	Output  *string         `json:"output,omitempty"`
	IsError *bool           `json:"isError,omitempty"`
}

type finalFrame struct {
	Type      string     `json:"type"`
	Text      string     `json:"text,omitempty"`
	ToolCalls []ToolCall `json:"toolCalls,omitempty"`
}

// Final is terminal success — it carries the durable final answer.
func Final(text string, toolCalls []ToolCall) (Frame, error) {
	return marshal(finalFrame{Type: "final", Text: text, ToolCalls: toolCalls})
}

type errorFrame struct {
	Type  string `json:"type"`
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}

// Error is terminal failure — a vetted error code, never raw prose.
func Error(message, code string) (Frame, error) {
	return marshal(errorFrame{Type: "error", Error: message, Code: code})
}

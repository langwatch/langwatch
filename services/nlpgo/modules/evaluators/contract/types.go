// Package contract is the evaluators module's public face: its API, the
// request and result shapes (langevals' wire, unchanged), its config and its
// error codes. Plan: dev/docs/plans/langevals-go-replacement.md §3.
package contract

import "encoding/json"

// Tenant is whose evaluation this is. It travels by name through services and
// channels; nothing about a tenant rides on context.Context.
type Tenant struct {
	ProjectID string
	// Env is the request's `env` verbatim: X_LITELLM_* / X_LITELLM_EMBEDDINGS_*
	// params and any install-level keys TS chose to forward. The only source of
	// provider credentials; the module never reads the process environment.
	Env map[string]string
}

// Entry is one row to evaluate, as langevals receives it. Contexts and
// conversation keep their raw JSON so every evaluator decodes its own shape.
type Entry struct {
	Input            *string         `json:"input,omitempty"`
	Output           *string         `json:"output,omitempty"`
	ExpectedOutput   *string         `json:"expected_output,omitempty"`
	Contexts         json.RawMessage `json:"contexts,omitempty"`
	ExpectedContexts json.RawMessage `json:"expected_contexts,omitempty"`
	Conversation     json.RawMessage `json:"conversation,omitempty"`
	// Golden, Candidates (a list of {id, output, cost?, duration?}) and
	// RowIndex are select_best_compare's own fields.
	Golden     *string         `json:"golden,omitempty"`
	Candidates json.RawMessage `json:"candidates,omitempty"`
	RowIndex   *int            `json:"row_index,omitempty"`
}

// TraceRequest continues the caller's trace into the tenant's project. With no
// Traceparent or no Token nothing is exported to the tenant (plan §6.1).
type TraceRequest struct {
	Traceparent string
	Token       string
}

// EvaluateRequest is one call: an evaluator over a batch of entries.
type EvaluateRequest struct {
	Tenant    Tenant
	Evaluator string // "{family}/{evaluator}", e.g. "langevals/exact_match"
	Entries   []Entry
	Settings  json.RawMessage
	Trace     TraceRequest
	// Shadow marks a comparison call the app makes beside Python's answer. It
	// runs from its own small budget, never the project's live share.
	Shadow bool
}

// Status is a result's outcome, as langevals names it.
type Status string

// The three statuses a result carries.
const (
	StatusProcessed Status = "processed"
	StatusSkipped   Status = "skipped"
	StatusError     Status = "error"
)

// Money is a cost, as langevals reports it.
type Money struct {
	Currency string  `json:"currency"`
	Amount   float64 `json:"amount"`
}

// Result is one entry's outcome; the JSON shape is langevals' so the TS side
// parses it unchanged.
type Result struct {
	Status    Status   `json:"status"`
	Score     *float64 `json:"score,omitempty"`
	Passed    *bool    `json:"passed,omitempty"`
	Label     *string  `json:"label,omitempty"`
	Details   *string  `json:"details,omitempty"`
	Cost      *Money   `json:"cost,omitempty"`
	ErrorType string   `json:"error_type,omitempty"`
	Traceback []string `json:"traceback,omitempty"`
	// RawResponse is the evaluator's own output (lingua's confidences,
	// PII findings), read by TS as `raw_response`.
	RawResponse json.RawMessage `json:"raw_response,omitempty"`
}

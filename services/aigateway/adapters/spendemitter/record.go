// Package spendemitter emits gateway spend commands (admitSpend,
// confirmSpend, failSpend) to the control plane's command ingest,
// asynchronously, through a bounded on-disk spool.
//
// The emission contract, deliberately: the request hot path never performs
// a networked write and is never delayed or refused for recordability.
// Records land in an in-process queue, a single writer appends them to the
// spool (batched writes, periodic fsync), and a drainer ships sealed
// segments to the control plane at-least-once, truncating only on ack.
// Completeness failures are bounded and detectable, never silent: every
// record carries a per-pod monotonic sequence number, so a consumer can
// assert gap-freedom per pod, and every local drop increments a counter.
package spendemitter

import (
	"encoding/json"
)

// Command names accepted by the control plane's spend-command ingest.
const (
	CommandAdmit   = "admitSpend"
	CommandConfirm = "confirmSpend"
	CommandFail    = "failSpend"
)

// Record is one spooled spend command. The wire batch is
// {"records": [Record, ...]} POSTed to the ingest endpoint.
type Record struct {
	Command string          `json:"command"`
	Payload json.RawMessage `json:"payload"`
	PodID   string          `json:"pod_id"`
	PodSeq  uint64          `json:"pod_seq"`
}

// UsagePayload is the token-class breakdown carried by confirm and fail
// payloads. Token counts only: rating happens in the pipeline, so cost
// never travels on this wire.
type UsagePayload struct {
	InputTokens         int `json:"input_tokens"`
	OutputTokens        int `json:"output_tokens"`
	CacheReadTokens     int `json:"cache_read_input_tokens"`
	CacheCreationTokens int `json:"cache_creation_input_tokens"`
	ReasoningTokens     int `json:"reasoning_tokens"`
}

// AdmittedPayload records that a request entered the gateway: identity and
// attribution, durable-intent side. Model here is the model as REQUESTED
// (resolution has not run yet when a request is admitted); the resolved
// model and the dispatched provider identity travel on the outcome payload.
type AdmittedPayload struct {
	GatewayRequestID string   `json:"gateway_request_id"`
	// Unix epoch MILLISECONDS: the ingest schema types occurred_at as a
	// bounded integer, never an RFC3339 string.
	OccurredAtUnixMs int64    `json:"occurred_at"`
	OrganizationID   string   `json:"organization_id"`
	ProjectID        string   `json:"project_id"`
	VirtualKeyID     string   `json:"virtual_key_id"`
	EndUserID        string   `json:"end_user_id,omitempty"`
	TraceID          string   `json:"trace_id,omitempty"`
	Model            string   `json:"model"`
	ModelProviderID  string   `json:"model_provider_id,omitempty"`
	Labels           []string `json:"labels,omitempty"`
	// The caller's metadata echo as its raw JSON TEXT (a string on the
	// wire), matching the ingest schema's string-typed field.
	Metadata    string `json:"metadata,omitempty"`
	RequestType string `json:"request_type,omitempty"`
}

// ConfirmedPayload records a served request's real quantities. Model and
// provider identity are repeated here because they are only fully resolved
// after dispatch; the projection applies them absolutely on receipt.
type ConfirmedPayload struct {
	GatewayRequestID string       `json:"gateway_request_id"`
	OccurredAtUnixMs int64        `json:"occurred_at"`
	ProjectID        string       `json:"project_id"`
	Usage            UsagePayload `json:"usage"`
	RateVersion      string       `json:"rate_version,omitempty"`
	Model            string       `json:"model,omitempty"`
	ModelProviderID  string       `json:"model_provider_id,omitempty"`
	DurationMS       int64        `json:"duration_ms"`
}

// FailedPayload records a request that did not complete: provider errors,
// timeouts, and the gateway's own rejections (budget, guardrail, rate
// limit, policy), which admit-then-fail so blocked traffic is visible.
type FailedPayload struct {
	GatewayRequestID string       `json:"gateway_request_id"`
	OccurredAtUnixMs int64        `json:"occurred_at"`
	ProjectID        string       `json:"project_id"`
	Error            ErrorPayload `json:"error"`
	Usage            UsagePayload `json:"usage"`
	Model            string       `json:"model,omitempty"`
	ModelProviderID  string       `json:"model_provider_id,omitempty"`
	DurationMS       int64        `json:"duration_ms"`
}

// ErrorPayload carries the full error taxonomy token plus the HTTP status
// the caller saw; never collapsed to a smaller enum.
type ErrorPayload struct {
	Type       string `json:"type"`
	HTTPStatus int    `json:"http_status"`
}

func usageFromDomain(prompt, completion, cacheRead, cacheCreation, reasoning int) UsagePayload {
	return UsagePayload{
		InputTokens:         prompt,
		OutputTokens:        completion,
		CacheReadTokens:     cacheRead,
		CacheCreationTokens: cacheCreation,
		ReasoningTokens:     reasoning,
	}
}

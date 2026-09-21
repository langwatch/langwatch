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
	"log/slog"
	"math"

	"github.com/langwatch/langwatch/services/aigateway/domain"
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

// UsagePayload is the billable-quantity breakdown carried by confirm and
// fail payloads. Quantities only: rating happens in the pipeline, so cost
// never travels on this wire.
//
// Every quantity a provider bills by belongs here, not only token classes.
// A character-priced or second-priced call whose quantities stop at this
// struct is rated at zero and debits nothing.
//
// InputAudioTokens and OutputAudioTokens are DISJOINT from InputTokens and
// OutputTokens (domain.Usage.SplitAudioTokens makes them so), because they
// price at their own, much higher, rate. InputImageTokens and
// OutputImageTokens follow the same rule, through SplitImageTokens. CacheReadTokens and
// CacheCreationTokens are disjoint from InputTokens for the same reason
// (domain.Usage.BillableInputTokens takes them out), and the customer span
// states the identical split. ReasoningTokens is the one exception: it stays
// a subset of OutputTokens, is reported for display, and is never priced.
type UsagePayload struct {
	InputTokens           int `json:"input_tokens"`
	OutputTokens          int `json:"output_tokens"`
	CacheReadTokens       int `json:"cache_read_input_tokens"`
	CacheCreationTokens   int `json:"cache_creation_input_tokens"`
	CacheCreation1hTokens int `json:"cache_creation_1h_tokens"`
	ReasoningTokens       int `json:"reasoning_tokens"`
	InputAudioTokens      int `json:"input_audio_tokens"`
	OutputAudioTokens     int `json:"output_audio_tokens"`
	InputImageTokens      int `json:"input_image_tokens"`
	OutputImageTokens     int `json:"output_image_tokens"`
	// ImageCount is how many images the call returned, the quantity a vendor
	// that prices per image bills.
	ImageCount int `json:"image_count"`
	InputChars int `json:"input_chars"`
	// Audio duration in whole MILLISECONDS. Every quantity on this wire is
	// an integer, and the rating seam divides by 1000 once.
	AudioMS int `json:"audio_ms"`
}

// AdmittedPayload records that a request entered the gateway: identity and
// attribution, durable-intent side. Model here is the model as REQUESTED
// (resolution has not run yet when a request is admitted); the resolved
// model and the dispatched provider identity travel on the outcome payload.
type AdmittedPayload struct {
	GatewayRequestID string `json:"gateway_request_id"`
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
	// OutcomeCarriesAttribution tells the control plane that this emitter
	// repeats the attribution on the outcome, so the consumers that join
	// admission to outcome need not persist anything at admission time.
	//
	// The admission is what declares it because the decision has to be made
	// when the admission is handled, before the outcome exists. Admission
	// and outcome always come from the same pod and the same build, so the
	// pair is self-consistent and the two services can roll in either
	// order. Always true from this build; removable once no build that
	// omits it is running anywhere.
	OutcomeCarriesAttribution bool `json:"outcome_carries_attribution"`
}

// AttributionPayload is who a request is billed against, repeated on each
// outcome so a consumer can act on one event instead of remembering every
// open admission. Embedded, so it flattens into the outcome payloads on the
// wire and matches the ingest schema's flat shape.
type AttributionPayload struct {
	OrganizationID string   `json:"organization_id,omitempty"`
	VirtualKeyID   string   `json:"virtual_key_id,omitempty"`
	EndUserID      string   `json:"end_user_id,omitempty"`
	TraceID        string   `json:"trace_id,omitempty"`
	RequestType    string   `json:"request_type,omitempty"`
	Labels         []string `json:"labels,omitempty"`
	// The caller's metadata echo as raw JSON TEXT, as on the admission.
	Metadata string `json:"metadata,omitempty"`
	// Unix epoch MILLISECONDS of the admission this outcome closes.
	AdmittedAtUnixMs int64 `json:"admitted_at,omitempty"`
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
	AttributionPayload
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
	AttributionPayload
}

// ErrorPayload carries the full error taxonomy token plus the HTTP status
// the caller saw; never collapsed to a smaller enum.
type ErrorPayload struct {
	Type       string `json:"type"`
	HTTPStatus int    `json:"http_status"`
}

// usageFromDomain maps every measured quantity onto the wire payload.
func usageFromDomain(u domain.Usage) UsagePayload {
	return UsagePayload{
		InputTokens:           u.BillableInputTokens(),
		OutputTokens:          u.CompletionTokens,
		CacheReadTokens:       u.CacheReadTokens,
		CacheCreationTokens:   u.CacheCreationTokens,
		CacheCreation1hTokens: u.CacheCreation1hTokens,
		ReasoningTokens:       u.ReasoningTokens,
		InputAudioTokens:      u.InputAudioTokens,
		OutputAudioTokens:     u.OutputAudioTokens,
		InputImageTokens:      u.InputImageTokens,
		OutputImageTokens:     u.OutputImageTokens,
		ImageCount:            u.ImageCount,
		InputChars:            u.InputChars,
		AudioMS:               audioMillis(u.AudioSeconds),
	}
}

// maxAudioSeconds bounds a single call's audio duration. A day of audio in
// one request is a corrupt measure, and at the highest per-second rate in
// the catalog it would rate a five-figure charge.
const maxAudioSeconds = 24 * 60 * 60

// audioMillis converts a measured duration to whole milliseconds, rounding
// half up. Anything that is not a plausible duration becomes zero and is
// logged: an unrateable quantity is a missing charge, which shows up in the
// spend surface, while a garbage one is a wrong charge, which does not.
func audioMillis(seconds float64) int {
	if seconds == 0 {
		return 0
	}
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) ||
		seconds < 0 || seconds > maxAudioSeconds {
		slog.Warn("spend emitter dropped an implausible audio duration",
			"audio_seconds", seconds)
		return 0
	}
	return int(math.Round(seconds * 1000))
}

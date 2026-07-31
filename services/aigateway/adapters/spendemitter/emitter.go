package spendemitter

import (
	"encoding/json"
	"log/slog"

	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
)

// Emitter implements pipeline.SpendEmitter over the spool. Every method is
// non-blocking by construction: payloads marshal in-memory and Append is a
// non-blocking channel send.
type Emitter struct {
	spool *Spool
}

// NewEmitter wraps an open spool.
func NewEmitter(spool *Spool) *Emitter { return &Emitter{spool: spool} }

func (e *Emitter) AdmitSpend(a pipeline.SpendAdmission) {
	payload := AdmittedPayload{
		GatewayRequestID: a.GatewayRequestID,
		OccurredAt:       a.OccurredAt.UTC(),
		OrganizationID:   a.OrganizationID,
		ProjectID:        a.ProjectID,
		VirtualKeyID:     a.VirtualKeyID,
		EndUserID:        a.EndUserID,
		Model:            a.Model,
		RequestType:      a.RequestType,
		Labels:           a.Labels,
	}
	// The echo is caller-controlled; invalid bytes inside a RawMessage would
	// invalidate the WHOLE record's JSON, losing the admission for a bad
	// header. Validate here and drop only the echo.
	if a.MetadataJSON != "" {
		if json.Valid([]byte(a.MetadataJSON)) {
			payload.Metadata = json.RawMessage(a.MetadataJSON)
		} else {
			slog.Warn("spend emitter dropped an invalid metadata echo",
				"gateway_request_id", a.GatewayRequestID)
		}
	}
	e.append(CommandAdmit, payload)
}

func (e *Emitter) ConfirmSpend(o pipeline.SpendOutcome) {
	e.append(CommandConfirm, ConfirmedPayload{
		GatewayRequestID: o.GatewayRequestID,
		OccurredAt:       o.OccurredAt.UTC(),
		Usage: usageFromDomain(
			o.Usage.PromptTokens,
			o.Usage.CompletionTokens,
			o.Usage.CacheReadTokens,
			o.Usage.CacheCreationTokens,
			0, // reasoning tokens do not reach domain.Usage today; see report
		),
		Model:           o.Model,
		ModelProviderID: o.ModelProviderID,
		DurationMS:      o.Duration.Milliseconds(),
	})
}

func (e *Emitter) FailSpend(o pipeline.SpendOutcome) {
	var errPayload ErrorPayload
	if o.Err != nil {
		errPayload = ErrorPayload{Type: o.Err.Type, HTTPStatus: o.Err.HTTPStatus}
	}
	e.append(CommandFail, FailedPayload{
		GatewayRequestID: o.GatewayRequestID,
		OccurredAt:       o.OccurredAt.UTC(),
		Error:            errPayload,
		Usage: usageFromDomain(
			o.Usage.PromptTokens,
			o.Usage.CompletionTokens,
			o.Usage.CacheReadTokens,
			o.Usage.CacheCreationTokens,
			0,
		),
		Model:           o.Model,
		ModelProviderID: o.ModelProviderID,
		DurationMS:      o.Duration.Milliseconds(),
	})
}

func (e *Emitter) append(command string, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		// A billing record must never vanish silently: this is the one drop
		// site the spool's counters cannot see.
		slog.Error("spend emitter dropped a record on marshal failure",
			"command", command, "error", err)
		return
	}
	e.spool.Append(Record{Command: command, Payload: raw})
}

// ensure interface conformance at compile time.
var _ pipeline.SpendEmitter = (*Emitter)(nil)

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

// AdmitSpend records a request's admission on the local spool.
func (e *Emitter) AdmitSpend(a pipeline.SpendAdmission) {
	payload := AdmittedPayload{
		GatewayRequestID: a.GatewayRequestID,
		OccurredAtUnixMs: a.OccurredAt.UTC().UnixMilli(),
		OrganizationID:   a.OrganizationID,
		ProjectID:        a.ProjectID,
		VirtualKeyID:     a.VirtualKeyID,
		EndUserID:        a.EndUserID,
		TraceID:          a.TraceID,
		Model:            a.Model,
		RequestType:      a.RequestType,
		Labels:           a.Labels,
	}
	// The echo is caller-controlled; ship it only when it is valid JSON so
	// a bad header costs the echo, never the admission.
	if a.MetadataJSON != "" {
		if json.Valid([]byte(a.MetadataJSON)) {
			payload.Metadata = a.MetadataJSON
		} else {
			slog.Warn("spend emitter dropped an invalid metadata echo",
				"gateway_request_id", a.GatewayRequestID)
		}
	}
	e.append(CommandAdmit, payload)
}

// ConfirmSpend records a served request's usage on the local spool.
func (e *Emitter) ConfirmSpend(o pipeline.SpendOutcome) {
	e.append(CommandConfirm, ConfirmedPayload{
		GatewayRequestID: o.GatewayRequestID,
		OccurredAtUnixMs: o.OccurredAt.UTC().UnixMilli(),
		ProjectID:        o.ProjectID,
		// reasoning tokens do not reach domain.Usage today; see report
		Usage:           usageFromDomain(o.Usage, 0),
		Model:           o.Model,
		ModelProviderID: o.ModelProviderID,
		DurationMS:      o.Duration.Milliseconds(),
	})
}

// FailSpend records a failed request's outcome on the local spool.
func (e *Emitter) FailSpend(o pipeline.SpendOutcome) {
	var errPayload ErrorPayload
	if o.Err != nil {
		errPayload = ErrorPayload{Type: o.Err.Type, HTTPStatus: o.Err.HTTPStatus}
	}
	e.append(CommandFail, FailedPayload{
		GatewayRequestID: o.GatewayRequestID,
		OccurredAtUnixMs: o.OccurredAt.UTC().UnixMilli(),
		ProjectID:        o.ProjectID,
		Error:            errPayload,
		Usage:            usageFromDomain(o.Usage, 0),
		Model:            o.Model,
		ModelProviderID:  o.ModelProviderID,
		DurationMS:       o.Duration.Milliseconds(),
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

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
		// This build repeats attribution on every outcome, which is what
		// lets the control plane skip the durable admission-to-outcome
		// join. See AdmittedPayload.OutcomeCarriesAttribution.
		OutcomeCarriesAttribution: true,
	}
	payload.Metadata = validMetadataEcho(a.MetadataJSON, a.GatewayRequestID)
	e.append(CommandAdmit, payload)
}

// ConfirmSpend records a served request's usage on the local spool.
func (e *Emitter) ConfirmSpend(o pipeline.SpendOutcome) {
	e.append(CommandConfirm, ConfirmedPayload{
		GatewayRequestID:   o.GatewayRequestID,
		OccurredAtUnixMs:   o.OccurredAt.UTC().UnixMilli(),
		ProjectID:          o.ProjectID,
		Usage:              usageFromDomain(o.Usage),
		Model:              o.Model,
		ModelProviderID:    o.ModelProviderID,
		DurationMS:         o.Duration.Milliseconds(),
		AttributionPayload: attributionPayload(o),
	})
}

// FailSpend records a failed request's outcome on the local spool.
func (e *Emitter) FailSpend(o pipeline.SpendOutcome) {
	var errPayload ErrorPayload
	if o.Err != nil {
		errPayload = ErrorPayload{Type: o.Err.Type, HTTPStatus: o.Err.HTTPStatus}
	}
	e.append(CommandFail, FailedPayload{
		GatewayRequestID:   o.GatewayRequestID,
		OccurredAtUnixMs:   o.OccurredAt.UTC().UnixMilli(),
		ProjectID:          o.ProjectID,
		Error:              errPayload,
		Usage:              usageFromDomain(o.Usage),
		Model:              o.Model,
		ModelProviderID:    o.ModelProviderID,
		DurationMS:         o.Duration.Milliseconds(),
		AttributionPayload: attributionPayload(o),
	})
}

// attributionPayload maps the outcome's copy of the admission attribution
// onto the wire, applying the same metadata-echo validation the admission
// applies: the two records must state the same thing, including when the
// echo is dropped.
func attributionPayload(o pipeline.SpendOutcome) AttributionPayload {
	a := o.Attribution
	payload := AttributionPayload{
		OrganizationID: a.OrganizationID,
		VirtualKeyID:   a.VirtualKeyID,
		EndUserID:      a.EndUserID,
		TraceID:        a.TraceID,
		RequestType:    a.RequestType,
		Labels:         a.Labels,
		Metadata:       validMetadataEcho(a.MetadataJSON, o.GatewayRequestID),
	}
	if !a.AdmittedAt.IsZero() {
		payload.AdmittedAtUnixMs = a.AdmittedAt.UTC().UnixMilli()
	}
	return payload
}

// maxMetadataEchoBytes mirrors the ingest schema's own bound on the echo.
// A value past it fails validation at the control plane, which rejects the
// whole record — so the emitter drops the echo here instead of losing the
// spend record to it.
const maxMetadataEchoBytes = 4096

// validMetadataEcho passes the caller-controlled echo through only when it
// matches what the ingest schema will accept, so a bad header costs the echo
// and never the record.
//
// The bar is a JSON OBJECT within the size bound, not merely valid JSON:
// `json.Valid` accepts `[1,2]`, `"x"` and `3`, all of which the control
// plane's `metadata must be a JSON object string` refinement rejects. Passing
// one through would trade a dropped echo for a dropped billing record.
func validMetadataEcho(raw string, gatewayRequestID string) string {
	if raw == "" {
		return ""
	}
	if len(raw) > maxMetadataEchoBytes {
		slog.Warn("spend emitter dropped an oversized metadata echo",
			"gateway_request_id", gatewayRequestID,
			"bytes", len(raw))
		return ""
	}
	var probe map[string]any
	if err := json.Unmarshal([]byte(raw), &probe); err != nil {
		slog.Warn("spend emitter dropped a metadata echo that is not a JSON object",
			"gateway_request_id", gatewayRequestID)
		return ""
	}
	return raw
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

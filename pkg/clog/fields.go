package clog

import (
	"context"

	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

// Standard correlation field keys stamped on log lines so logs are filterable
// and joinable with traces in Grafana/Loki. Keep these in lockstep with the TS
// app's getLogContext() (src/server/context/logging.ts) so a trace can be
// followed across the TS app and the Go services with the same field names.
const (
	FieldTraceID        = "trace_id"
	FieldSpanID         = "span_id"
	FieldUserID         = "user_id"
	FieldProjectID      = "project_id"
	FieldTenantID       = "tenant_id"
	FieldOrganizationID = "organization_id"
	FieldTeamID         = "team_id"

	// Observed = a trace/span that belongs to the CUSTOMER — a trace we are
	// ingesting, proxying, or continuing on their behalf — kept deliberately
	// distinct from the service's own trace_id/span_id. e.g. the AI gateway
	// runs its own ops trace (trace_id/span_id) while the customer's LLM call
	// carries its own trace (observed.*).
	FieldObservedTraceID = "observed.trace_id"
	FieldObservedSpanID  = "observed.span_id"
)

// Identity carries the tenant hierarchy for a request. Empty fields are
// omitted, so a machine-to-machine service (no user) simply doesn't stamp
// user_id.
type Identity struct {
	UserID         string
	ProjectID      string
	TenantID       string
	OrganizationID string
	TeamID         string
}

func (id Identity) fields() []zap.Field {
	fields := make([]zap.Field, 0, 5)
	if id.UserID != "" {
		fields = append(fields, zap.String(FieldUserID, id.UserID))
	}
	if id.ProjectID != "" {
		fields = append(fields, zap.String(FieldProjectID, id.ProjectID))
	}
	if id.TenantID != "" {
		fields = append(fields, zap.String(FieldTenantID, id.TenantID))
	}
	if id.OrganizationID != "" {
		fields = append(fields, zap.String(FieldOrganizationID, id.OrganizationID))
	}
	if id.TeamID != "" {
		fields = append(fields, zap.String(FieldTeamID, id.TeamID))
	}
	return fields
}

// WithIdentity stamps the non-empty identity fields onto the context logger so
// every downstream log line carries them.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	fields := id.fields()
	if len(fields) == 0 {
		return ctx
	}
	return With(ctx, fields...)
}

// WithSpanContext stamps the ACTIVE span's trace_id/span_id (the service's own
// operation) onto the context logger. No-op if there is no valid span, so it is
// always safe to call.
func WithSpanContext(ctx context.Context) context.Context {
	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() {
		return ctx
	}
	return With(ctx,
		zap.String(FieldTraceID, sc.TraceID().String()),
		zap.String(FieldSpanID, sc.SpanID().String()),
	)
}

// WithObserved stamps a CUSTOMER trace/span — one we're observing, proxying, or
// continuing, not our own — onto the context logger as observed.trace_id /
// observed.span_id. No-op if the span context is invalid.
func WithObserved(ctx context.Context, sc trace.SpanContext) context.Context {
	if !sc.IsValid() {
		return ctx
	}
	return With(ctx,
		zap.String(FieldObservedTraceID, sc.TraceID().String()),
		zap.String(FieldObservedSpanID, sc.SpanID().String()),
	)
}

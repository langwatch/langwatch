package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// TestEnrichRequestLogContext_StampsProjectIDTraceIDOrigin pins
// langwatch_nlp regression ff42237f3 ("add logging and project id to
// nlp logging") on the Go path. Without project_id stamped onto the
// log fields, prod logs from nlpgo can't be filtered to a single
// customer's traffic — incident triage and per-customer debugging
// regress to grepping by request_id alone.
//
// The test captures the zap output to verify all three correlation
// keys (project_id, trace_id, origin) appear on a downstream log
// emitted via the enriched context.
func TestEnrichRequestLogContext_StampsProjectIDTraceIDOrigin(t *testing.T) {
	var buf bytes.Buffer
	encoderCfg := zap.NewProductionEncoderConfig()
	encoderCfg.TimeKey = "" // strip time to keep the assertion stable
	core := zapcore.NewCore(
		zapcore.NewJSONEncoder(encoderCfg),
		zapcore.AddSync(&buf),
		zapcore.InfoLevel,
	)
	logger := zap.New(core)
	ctx := clog.Set(context.Background(), logger)

	enriched := enrichRequestLogContext(ctx, &app.WorkflowRequest{
		ProjectID: "proj_acme",
		TraceID:   "trace_abc123",
		Origin:    "workflow",
	})
	clog.Get(enriched).Info("execute_flow_received")

	var line map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &line); err != nil {
		t.Fatalf("parse log line %q: %v", buf.String(), err)
	}
	if got := line["project_id"]; got != "proj_acme" {
		t.Errorf("project_id = %v; want proj_acme", got)
	}
	if got := line["trace_id"]; got != "trace_abc123" {
		t.Errorf("trace_id = %v; want trace_abc123", got)
	}
	if got := line["origin"]; got != "workflow" {
		t.Errorf("origin = %v; want workflow", got)
	}
}

// TestEnrichRequestLogContext_OmitsAbsentFields guards the false-
// positive direction: a request with no ProjectID / TraceID / Origin
// (e.g. legacy callers that haven't started populating the field
// yet) must NOT inject empty-string log fields. Empty fields would
// pollute the log surface and break dashboards that filter on
// `project_id != ""`.
func TestEnrichRequestLogContext_OmitsAbsentFields(t *testing.T) {
	var buf bytes.Buffer
	encoderCfg := zap.NewProductionEncoderConfig()
	encoderCfg.TimeKey = ""
	core := zapcore.NewCore(
		zapcore.NewJSONEncoder(encoderCfg),
		zapcore.AddSync(&buf),
		zapcore.InfoLevel,
	)
	logger := zap.New(core)
	ctx := clog.Set(context.Background(), logger)

	enriched := enrichRequestLogContext(ctx, &app.WorkflowRequest{})
	clog.Get(enriched).Info("execute_flow_received")

	out := buf.String()
	for _, key := range []string{`"project_id"`, `"trace_id"`, `"origin"`} {
		if strings.Contains(out, key) {
			t.Errorf("expected %s absent for empty WorkflowRequest, got line %q", key, out)
		}
	}
}

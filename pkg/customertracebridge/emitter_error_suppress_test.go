package customertracebridge

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// recordSpanForParams runs the emitter's span lifecycle for arbitrary trace
// params and returns the ended span via an in-memory recorder. The recorder
// captures every ended span regardless of the drop marker (drop is enforced at
// export, not at span-end), so tests can assert the marker directly.
func recordSpanForParams(t *testing.T, params domain.AITraceParams) sdktrace.ReadOnlySpan {
	t.Helper()
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	e := &Emitter{tp: tp, tracer: tp.Tracer("test"), propagator: propagation.TraceContext{}}

	ctx, _ := e.BeginSpan(context.Background(), "proj-test", domain.RequestTypeMessages)
	e.EndSpan(ctx, params)

	spans := sr.Ended()
	require.Len(t, spans, 1)
	return spans[0]
}

func hasBoolAttr(span sdktrace.ReadOnlySpan, key string) (bool, bool) {
	for _, kv := range span.Attributes() {
		if string(kv.Key) == key {
			return kv.Value.AsBool(), true
		}
	}
	return false, false
}

func hasStringAttr(span sdktrace.ReadOnlySpan, key string) (string, bool) {
	for _, kv := range span.Attributes() {
		if string(kv.Key) == key {
			return kv.Value.AsString(), true
		}
	}
	return "", false
}

// When the request failed upstream, the customer trace must surface the error
// (HTTP status + error.type + Error span status) instead of being silently
// dropped, so users can see the failed request in the trace list.
func TestEmitter_UpstreamError_StampsStatusAndErrorType(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID:         domain.ProviderAnthropic,
		Model:              "claude-opus-4-7",
		UpstreamStatusCode: 504,
		UpstreamErrorType:  "provider_timeout",
	})

	status, ok := findIntAttr(span, "http.response.status_code")
	require.True(t, ok, "errored span must carry http.response.status_code")
	assert.Equal(t, int64(504), status)

	et, ok := hasStringAttr(span, "error.type")
	require.True(t, ok, "errored span must carry error.type")
	assert.Equal(t, "provider_timeout", et)

	assert.Equal(t, codes.Error, span.Status().Code, "span status must be Error")

	// An errored span is NEVER suppressed, even with zero tokens / no output.
	_, dropped := hasBoolAttr(span, "langwatch.reserved.drop")
	assert.False(t, dropped, "errored spans must not be marked for drop")
}

// claude-code fires internal probe calls (system-reminder / skills-list pings)
// that return no usage and no assistant content. A successful zero-cost,
// no-output span is marked for drop so it does not clutter the trace list.
func TestEmitter_ZeroCostNoOutputSuccess_MarkedForDrop(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID: domain.ProviderAnthropic,
		Model:      "claude-opus-4-7",
		Usage:      domain.Usage{PromptTokens: 6, CompletionTokens: 0, CostMicroUSD: 0},
		// no ResponseBody -> extractOutputMessages == ""
	})

	drop, ok := hasBoolAttr(span, "langwatch.reserved.drop")
	require.True(t, ok, "zero-cost no-output success must carry the drop marker")
	assert.True(t, drop)
}

// A span with real output OR real cost is a genuine generation and must NOT be
// suppressed, even if one of the other signals is zero.
func TestEmitter_RealGeneration_NotMarkedForDrop(t *testing.T) {
	t.Run("has completion tokens", func(t *testing.T) {
		span := recordSpanForParams(t, domain.AITraceParams{
			ProviderID: domain.ProviderAnthropic,
			Model:      "claude-opus-4-7",
			Usage:      domain.Usage{PromptTokens: 6, CompletionTokens: 8, CostMicroUSD: 0},
		})
		_, dropped := hasBoolAttr(span, "langwatch.reserved.drop")
		assert.False(t, dropped)
	})

	t.Run("has cost", func(t *testing.T) {
		span := recordSpanForParams(t, domain.AITraceParams{
			ProviderID: domain.ProviderAnthropic,
			Model:      "claude-opus-4-7",
			Usage:      domain.Usage{PromptTokens: 6, CompletionTokens: 0, CostMicroUSD: 1200},
		})
		_, dropped := hasBoolAttr(span, "langwatch.reserved.drop")
		assert.False(t, dropped, "a span that cost money must always be visible")
	})
}

// dropFilterExporter omits marked spans at export but forwards everything else.
func TestDropFilterExporter_OmitsMarkedSpans(t *testing.T) {
	// Produce two ended spans: one marked for drop, one not.
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tr := tp.Tracer("test")

	_, keep := tr.Start(context.Background(), "keep")
	keep.End()
	_, drop := tr.Start(context.Background(), "drop")
	drop.SetAttributes(attrDrop.Bool(true))
	drop.End()

	ended := sr.Ended()
	require.Len(t, ended, 2)

	inner := tracetest.NewInMemoryExporter()
	filter := dropFilterExporter{inner: inner}
	require.NoError(t, filter.ExportSpans(context.Background(), ended))

	got := inner.GetSpans()
	require.Len(t, got, 1, "only the unmarked span should be forwarded")
	assert.Equal(t, "keep", got[0].Name)
}

// A batch that is entirely drop-marked exports nothing (and does not call the
// inner exporter with an empty slice).
func TestDropFilterExporter_AllDropped_NoForward(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tr := tp.Tracer("test")
	_, drop := tr.Start(context.Background(), "drop")
	drop.SetAttributes(attrDrop.Bool(true))
	drop.End()

	inner := tracetest.NewInMemoryExporter()
	filter := dropFilterExporter{inner: inner}
	require.NoError(t, filter.ExportSpans(context.Background(), sr.Ended()))
	assert.Empty(t, inner.GetSpans())
}

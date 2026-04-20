package otel

import (
	"context"
	"net/http/httptest"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestEnrichFromRequestHeaders(t *testing.T) {
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	tracer := tp.Tracer("test")

	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	req.Header.Set(HeaderPrincipal, "user_custom_42")
	req.Header.Set(HeaderThreadID, "thread_01KQ")

	ctx, span := tracer.Start(context.Background(), "enrich")
	ctx = context.WithValue(ctx, spanKey{}, span)

	EnrichFromRequestHeaders(ctx, req)
	span.End()

	spans := rec.Ended()
	if len(spans) != 1 {
		t.Fatalf("want 1 span, got %d", len(spans))
	}
	attrs := map[string]string{}
	for _, kv := range spans[0].Attributes() {
		attrs[string(kv.Key)] = kv.Value.AsString()
	}
	if attrs[AttrPrincipalID] != "user_custom_42" {
		t.Errorf("want principal_id=user_custom_42, got %q", attrs[AttrPrincipalID])
	}
	if attrs[AttrThreadID] != "thread_01KQ" {
		t.Errorf("want thread_id=thread_01KQ, got %q", attrs[AttrThreadID])
	}
}

func TestRecordException_AttachesAsSpanEvent(t *testing.T) {
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	tracer := tp.Tracer("test")

	ctx, span := tracer.Start(context.Background(), "test")
	RecordException(ctx, "model_resolve_failed", `provider "cohere" is not bound on this virtual key (bound: openai) — try "command-r"`)
	span.End()

	spans := rec.Ended()
	if len(spans) != 1 {
		t.Fatalf("want 1 span, got %d", len(spans))
	}
	events := spans[0].Events()
	if len(events) != 1 {
		t.Fatalf("want 1 exception event, got %d", len(events))
	}
	if events[0].Name != "exception" {
		t.Errorf("event name: want exception, got %s", events[0].Name)
	}
	got := map[string]string{}
	for _, kv := range events[0].Attributes {
		got[string(kv.Key)] = kv.Value.AsString()
	}
	if got["exception.type"] != "model_resolve_failed" {
		t.Errorf("exception.type mismatch: %v", got)
	}
	if got["exception.message"] == "" {
		t.Errorf("exception.message not recorded: %v", got)
	}
}

func TestRecordException_IgnoresEmptyMessage(t *testing.T) {
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	tracer := tp.Tracer("test")

	ctx, span := tracer.Start(context.Background(), "test")
	RecordException(ctx, "x", "")
	span.End()

	events := rec.Ended()[0].Events()
	if len(events) != 0 {
		t.Errorf("empty message should not record an event, got %d events", len(events))
	}
}

func TestEnrichFromRequestHeaders_NoHeaders(t *testing.T) {
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	tracer := tp.Tracer("test")

	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	ctx, span := tracer.Start(context.Background(), "enrich")
	ctx = context.WithValue(ctx, spanKey{}, span)

	EnrichFromRequestHeaders(ctx, req)
	span.End()

	spans := rec.Ended()
	if len(spans) != 1 {
		t.Fatal("want 1 span")
	}
	for _, kv := range spans[0].Attributes() {
		if string(kv.Key) == AttrPrincipalID || string(kv.Key) == AttrThreadID {
			t.Errorf("unexpected attr %s=%v", kv.Key, kv.Value.AsString())
		}
	}
}

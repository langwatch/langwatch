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

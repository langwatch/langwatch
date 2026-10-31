package testutil

import (
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// CreateMockSpan creates a mock ReadOnlySpan for testing.
func CreateMockSpan(name, scopeName string) sdktrace.ReadOnlySpan {
	stub := tracetest.SpanStub{
		Name:                 name,
		InstrumentationScope: instrumentation.Scope{Name: scopeName},
	}
	return stub.Snapshot()
}

// CreateMockSpanWithAttributes creates a mock ReadOnlySpan carrying span attributes.
func CreateMockSpanWithAttributes(name, scopeName string, attrs ...attribute.KeyValue) sdktrace.ReadOnlySpan {
	stub := tracetest.SpanStub{
		Name:                 name,
		InstrumentationScope: instrumentation.Scope{Name: scopeName},
		Attributes:           attrs,
	}
	return stub.Snapshot()
}

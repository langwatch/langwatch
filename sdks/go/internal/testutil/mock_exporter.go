// Package testutil provides shared test utilities for the LangWatch SDK.
package testutil

import (
	"context"
	"sync"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// MockExporter captures exported spans for testing.
type MockExporter struct {
	mu    sync.Mutex
	spans []sdktrace.ReadOnlySpan
}

// NewMockExporter creates a new MockExporter.
func NewMockExporter() *MockExporter {
	return &MockExporter{}
}

// ExportSpans captures spans for later inspection.
func (m *MockExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.spans = append(m.spans, spans...)
	return nil
}

// Shutdown is a no-op for the mock exporter.
func (m *MockExporter) Shutdown(ctx context.Context) error {
	return nil
}

// GetSpans returns all captured spans.
func (m *MockExporter) GetSpans() []sdktrace.ReadOnlySpan {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.spans
}

// Clear removes all captured spans.
func (m *MockExporter) Clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.spans = nil
}

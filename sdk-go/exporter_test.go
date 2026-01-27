package langwatch

import (
	"context"
	"os"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// mockSpanExporter creates a mock ReadOnlySpan for testing using tracetest.SpanStub.
func mockSpanExporter(name string, scopeName string) sdktrace.ReadOnlySpan {
	stub := tracetest.SpanStub{
		Name:                 name,
		InstrumentationScope: instrumentation.Scope{Name: scopeName},
	}
	return stub.Snapshot()
}

// mockExporter captures exported spans for testing.
type mockExporter struct {
	mu    sync.Mutex
	spans []sdktrace.ReadOnlySpan
}

func newMockExporter() *mockExporter {
	return &mockExporter{}
}

func (m *mockExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.spans = append(m.spans, spans...)
	return nil
}

func (m *mockExporter) Shutdown(ctx context.Context) error {
	return nil
}

func (m *mockExporter) GetSpans() []sdktrace.ReadOnlySpan {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.spans
}

func (m *mockExporter) Clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.spans = nil
}

func TestFilteringExporter_NoFilters(t *testing.T) {
	mock := newMockExporter()
	exporter := NewFilteringExporter(mock)

	spans := []sdktrace.ReadOnlySpan{
		mockSpanExporter("span1", "scope1"),
		mockSpanExporter("span2", "scope2"),
	}

	err := exporter.ExportSpans(context.Background(), spans)
	require.NoError(t, err)

	assert.Len(t, mock.GetSpans(), 2)
}

func TestFilteringExporter_WithFilters(t *testing.T) {
	mock := newMockExporter()
	exporter := NewFilteringExporter(mock,
		ExcludeHTTPRequests(),
	)

	spans := []sdktrace.ReadOnlySpan{
		mockSpanExporter("GET /api", "net/http"),
		mockSpanExporter("llm.chat", "openai"),
	}

	err := exporter.ExportSpans(context.Background(), spans)
	require.NoError(t, err)

	result := mock.GetSpans()
	assert.Len(t, result, 1)
	assert.Equal(t, "llm.chat", result[0].Name())
}

func TestFilteringExporter_EmptySpans(t *testing.T) {
	mock := newMockExporter()
	exporter := NewFilteringExporter(mock)

	err := exporter.ExportSpans(context.Background(), nil)
	require.NoError(t, err)

	assert.Len(t, mock.GetSpans(), 0)
}

func TestFilteringExporter_AllFiltered(t *testing.T) {
	mock := newMockExporter()
	exporter := NewFilteringExporter(mock,
		ExcludeHTTPRequests(),
	)

	spans := []sdktrace.ReadOnlySpan{
		mockSpanExporter("GET /api", "net/http"),
		mockSpanExporter("POST /api", "net/http"),
	}

	err := exporter.ExportSpans(context.Background(), spans)
	require.NoError(t, err)

	// Mock exporter should not be called when all spans are filtered
	assert.Len(t, mock.GetSpans(), 0)
}

func TestFilteringExporter_Shutdown(t *testing.T) {
	mock := newMockExporter()
	exporter := NewFilteringExporter(mock)

	err := exporter.Shutdown(context.Background())
	require.NoError(t, err)
}

func TestFilteringExporter_MultipleFilters(t *testing.T) {
	mock := newMockExporter()
	exporter := NewFilteringExporter(mock,
		ExcludeHTTPRequests(),
		Exclude(Criteria{
			SpanName: []Matcher{StartsWith("database.")},
		}),
	)

	spans := []sdktrace.ReadOnlySpan{
		mockSpanExporter("GET /api", "net/http"),
		mockSpanExporter("database.query", "database/sql"),
		mockSpanExporter("llm.chat", "openai"),
	}

	err := exporter.ExportSpans(context.Background(), spans)
	require.NoError(t, err)

	result := mock.GetSpans()
	assert.Len(t, result, 1)
	assert.Equal(t, "llm.chat", result[0].Name())
}

func TestExporterConfig_EnvironmentVariables(t *testing.T) {
	// Save original values
	originalAPIKey := os.Getenv("LANGWATCH_API_KEY")
	originalEndpoint := os.Getenv("LANGWATCH_ENDPOINT")
	defer func() {
		os.Setenv("LANGWATCH_API_KEY", originalAPIKey)
		os.Setenv("LANGWATCH_ENDPOINT", originalEndpoint)
	}()

	// Set test values
	os.Setenv("LANGWATCH_API_KEY", "test-api-key")
	os.Setenv("LANGWATCH_ENDPOINT", "https://custom.langwatch.ai")

	cfg := &exporterConfig{
		apiKey:   os.Getenv("LANGWATCH_API_KEY"),
		endpoint: os.Getenv("LANGWATCH_ENDPOINT"),
	}

	assert.Equal(t, "test-api-key", cfg.apiKey)
	assert.Equal(t, "https://custom.langwatch.ai", cfg.endpoint)
}

func TestExporterConfig_DefaultEndpoint(t *testing.T) {
	// Save original values
	originalEndpoint := os.Getenv("LANGWATCH_ENDPOINT")
	defer func() {
		os.Setenv("LANGWATCH_ENDPOINT", originalEndpoint)
	}()

	// Clear endpoint
	os.Unsetenv("LANGWATCH_ENDPOINT")

	cfg := &exporterConfig{
		endpoint: os.Getenv("LANGWATCH_ENDPOINT"),
	}

	if cfg.endpoint == "" {
		cfg.endpoint = DefaultEndpoint
	}

	assert.Equal(t, DefaultEndpoint, cfg.endpoint)
}

func TestExporterOption_WithAPIKey(t *testing.T) {
	cfg := &exporterConfig{}
	opt := WithAPIKey("my-api-key")
	opt(cfg)

	assert.Equal(t, "my-api-key", cfg.apiKey)
}

func TestExporterOption_WithEndpoint(t *testing.T) {
	cfg := &exporterConfig{}
	opt := WithEndpoint("https://my-endpoint.com")
	opt(cfg)

	assert.Equal(t, "https://my-endpoint.com", cfg.endpoint)
}

func TestExporterOption_WithFilters(t *testing.T) {
	cfg := &exporterConfig{}
	filter1 := ExcludeHTTPRequests()
	filter2 := LangWatchOnly()

	opt := WithFilters(filter1, filter2)
	opt(cfg)

	assert.Len(t, cfg.filters, 2)
}

func TestExporterOption_WithFilters_Appends(t *testing.T) {
	cfg := &exporterConfig{
		filters: []Filter{ExcludeHTTPRequests()},
	}

	opt := WithFilters(LangWatchOnly())
	opt(cfg)

	assert.Len(t, cfg.filters, 2)
}

func TestVersion(t *testing.T) {
	assert.NotEmpty(t, Version)
	assert.Equal(t, "0.1.0", Version)
}

func TestDefaultEndpoint(t *testing.T) {
	assert.Equal(t, "https://app.langwatch.ai", DefaultEndpoint)
}

func TestTracesPath(t *testing.T) {
	assert.Equal(t, "/api/otel/v1/traces", TracesPath)
}

package langwatch

import (
	"context"
	"os"
	"testing"

	"github.com/langwatch/langwatch/sdk-go/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestFilteringExporter_NoFilters(t *testing.T) {
	mock := testutil.NewMockExporter()
	exporter := NewFilteringExporter(mock)

	spans := []sdktrace.ReadOnlySpan{
		testutil.CreateMockSpan("span1", "scope1"),
		testutil.CreateMockSpan("span2", "scope2"),
	}

	err := exporter.ExportSpans(context.Background(), spans)
	require.NoError(t, err)

	assert.Len(t, mock.GetSpans(), 2)
}

func TestFilteringExporter_WithFilters(t *testing.T) {
	mock := testutil.NewMockExporter()
	exporter := NewFilteringExporter(mock,
		ExcludeHTTPRequests(),
	)

	spans := []sdktrace.ReadOnlySpan{
		testutil.CreateMockSpan("GET /api", "net/http"),
		testutil.CreateMockSpan("llm.chat", "openai"),
	}

	err := exporter.ExportSpans(context.Background(), spans)
	require.NoError(t, err)

	result := mock.GetSpans()
	assert.Len(t, result, 1)
	assert.Equal(t, "llm.chat", result[0].Name())
}

func TestFilteringExporter_EmptySpans(t *testing.T) {
	mock := testutil.NewMockExporter()
	exporter := NewFilteringExporter(mock)

	err := exporter.ExportSpans(context.Background(), nil)
	require.NoError(t, err)

	assert.Len(t, mock.GetSpans(), 0)
}

func TestFilteringExporter_AllFiltered(t *testing.T) {
	mock := testutil.NewMockExporter()
	exporter := NewFilteringExporter(mock,
		ExcludeHTTPRequests(),
	)

	spans := []sdktrace.ReadOnlySpan{
		testutil.CreateMockSpan("GET /api", "net/http"),
		testutil.CreateMockSpan("POST /api", "net/http"),
	}

	err := exporter.ExportSpans(context.Background(), spans)
	require.NoError(t, err)

	// Mock exporter should not be called when all spans are filtered
	assert.Len(t, mock.GetSpans(), 0)
}

func TestFilteringExporter_Shutdown(t *testing.T) {
	mock := testutil.NewMockExporter()
	exporter := NewFilteringExporter(mock)

	err := exporter.Shutdown(context.Background())
	require.NoError(t, err)
}

func TestFilteringExporter_MultipleFilters(t *testing.T) {
	mock := testutil.NewMockExporter()
	exporter := NewFilteringExporter(mock,
		ExcludeHTTPRequests(),
		Exclude(Criteria{
			SpanName: []Matcher{StartsWith("database.")},
		}),
	)

	spans := []sdktrace.ReadOnlySpan{
		testutil.CreateMockSpan("GET /api", "net/http"),
		testutil.CreateMockSpan("database.query", "database/sql"),
		testutil.CreateMockSpan("llm.chat", "openai"),
	}

	err := exporter.ExportSpans(context.Background(), spans)
	require.NoError(t, err)

	result := mock.GetSpans()
	assert.Len(t, result, 1)
	assert.Equal(t, "llm.chat", result[0].Name())
}

func TestResolveConfig_EnvironmentVariables(t *testing.T) {
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

	cfg := resolveConfig()

	assert.Equal(t, "test-api-key", cfg.apiKey)
	assert.Equal(t, "https://custom.langwatch.ai", cfg.endpoint)
}

func TestResolveConfig_DefaultEndpoint(t *testing.T) {
	// Save original values
	originalEndpoint := os.Getenv("LANGWATCH_ENDPOINT")
	defer func() {
		os.Setenv("LANGWATCH_ENDPOINT", originalEndpoint)
	}()

	// Clear endpoint
	os.Unsetenv("LANGWATCH_ENDPOINT")

	cfg := resolveConfig()

	assert.Equal(t, DefaultEndpoint, cfg.endpoint)
}

func TestResolveConfig_OptionsOverrideEnv(t *testing.T) {
	// Save original values
	originalAPIKey := os.Getenv("LANGWATCH_API_KEY")
	originalEndpoint := os.Getenv("LANGWATCH_ENDPOINT")
	defer func() {
		os.Setenv("LANGWATCH_API_KEY", originalAPIKey)
		os.Setenv("LANGWATCH_ENDPOINT", originalEndpoint)
	}()

	// Set environment values
	os.Setenv("LANGWATCH_API_KEY", "env-key")
	os.Setenv("LANGWATCH_ENDPOINT", "https://env.langwatch.ai")

	// Options should override
	cfg := resolveConfig(
		WithAPIKey("option-key"),
		WithEndpoint("https://option.langwatch.ai"),
	)

	assert.Equal(t, "option-key", cfg.apiKey)
	assert.Equal(t, "https://option.langwatch.ai", cfg.endpoint)
}

func TestBuildHeaders(t *testing.T) {
	headers := buildHeaders("test-api-key")

	assert.Equal(t, "Bearer test-api-key", headers["Authorization"])
	assert.Equal(t, "langwatch-sdk-go", headers["x-langwatch-sdk-name"])
	assert.Equal(t, "go", headers["x-langwatch-sdk-language"])
	assert.Equal(t, Version, headers["x-langwatch-sdk-version"])
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

func TestNewExporter_Success(t *testing.T) {
	// Test successful creation with valid config
	// Note: This creates a real OTLP exporter that will fail to connect,
	// but creation should succeed
	exporter, err := NewExporter(context.Background(),
		WithAPIKey("test-key"),
		WithEndpoint("https://test.langwatch.ai"),
	)
	require.NoError(t, err)
	require.NotNil(t, exporter)

	// Verify the embedded FilteringExporter is present
	require.NotNil(t, exporter.FilteringExporter)

	// Cleanup
	exporter.Shutdown(context.Background())
}

func TestNewDefaultExporter_HasHTTPFilter(t *testing.T) {
	// Verify NewDefaultExporter includes ExcludeHTTPRequests
	// by checking that HTTP spans are filtered

	// Create a mock exporter to capture what gets through
	mock := testutil.NewMockExporter()

	// We can't easily test NewDefaultExporter directly since it creates
	// a real OTLP connection. Instead, test the filter composition:
	defaultOpts := []ExporterOption{WithFilters(ExcludeHTTPRequests())}
	cfg := resolveConfig(defaultOpts...)

	filteringExp := NewFilteringExporter(mock, cfg.filters...)

	spans := []sdktrace.ReadOnlySpan{
		testutil.CreateMockSpan("GET /api", "net/http"),
		testutil.CreateMockSpan("llm.chat", "openai"),
	}

	err := filteringExp.ExportSpans(context.Background(), spans)
	require.NoError(t, err)

	// Only non-HTTP span should pass through
	result := mock.GetSpans()
	assert.Len(t, result, 1)
	assert.Equal(t, "llm.chat", result[0].Name())
}

func TestLangWatchExporter_InheritsFilteringExporterMethods(t *testing.T) {
	// Verify that LangWatchExporter properly inherits methods from FilteringExporter
	mock := testutil.NewMockExporter()
	filteringExp := NewFilteringExporter(mock, ExcludeHTTPRequests())
	exporter := &LangWatchExporter{FilteringExporter: filteringExp}

	spans := []sdktrace.ReadOnlySpan{
		testutil.CreateMockSpan("GET /api", "net/http"),
		testutil.CreateMockSpan("llm.chat", "openai"),
	}

	// ExportSpans should work through embedding
	err := exporter.ExportSpans(context.Background(), spans)
	require.NoError(t, err)

	result := mock.GetSpans()
	assert.Len(t, result, 1)
	assert.Equal(t, "llm.chat", result[0].Name())

	// Shutdown should also work
	err = exporter.Shutdown(context.Background())
	require.NoError(t, err)
}

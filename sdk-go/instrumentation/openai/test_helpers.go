package openai

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	openai "github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/log"
	"go.opentelemetry.io/otel/log/logtest"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// setupTestTracing creates a test tracing environment with proper cleanup
func setupTestTracing(t *testing.T) (*tracetest.InMemoryExporter, func()) {
	exporter := tracetest.NewInMemoryExporter()
	sp := sdktrace.NewSimpleSpanProcessor(exporter)
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))

	// Set the global tracer provider
	originalProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)

	cleanup := func() {
		_ = sp.Shutdown(context.Background())
		_ = exporter.Shutdown(context.Background())
		otel.SetTracerProvider(originalProvider)
	}

	return exporter, cleanup
}

// findAttr finds an attribute in a slice by key
func findAttr(attrs []attribute.KeyValue, key attribute.Key) (attribute.Value, bool) {
	for _, attr := range attrs {
		if attr.Key == key {
			return attr.Value, true
		}
	}
	return attribute.Value{}, false
}

// mockRoundTripper provides simple HTTP response mocking
type mockRoundTripper struct {
	roundTrip func(req *http.Request) (*http.Response, error)
}

func (m *mockRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := m.roundTrip(req)
	if err != nil {
		return resp, err
	}

	// Ensure the response has a reference to the original request
	// This is needed for proper routing in the response processor
	if resp != nil {
		resp.Request = req
	}

	return resp, nil
}

// newMockHTTPClient creates a mock HTTP client with custom response behavior
func newMockHTTPClient(rt func(req *http.Request) (*http.Response, error)) *http.Client {
	return &http.Client{
		Transport: &mockRoundTripper{roundTrip: rt},
	}
}

// =============================================================================
// CONTENT LOGGING TEST HELPERS
// =============================================================================

// ContentLoggingTestCase defines a test case for content logging
type ContentLoggingTestCase struct {
	Name                  string
	Options               []Option
	ExpectedUserContent   bool
	ExpectedSystemContent bool
	ExpectedOutputContent bool
}

// runContentLoggingTest runs a single content logging test case for ChatCompletions API
func runContentLoggingTest(t *testing.T, tc ContentLoggingTestCase, responseBody string, makeAPICall func(*openai.Client) error, expectedContents []string) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Create test logger recorder to capture content
	logRecorder := logtest.NewRecorder()

	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	// Build middleware options with test logger
	middlewareOptions := append([]Option{
		WithLoggerProvider(logRecorder),
	}, tc.Options...)

	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client", middlewareOptions...)),
	)

	// Make API call
	err := makeAPICall(&client)
	require.NoError(t, err)

	// Verify span creation
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)

	// Verify logged content
	recording := logRecorder.Result()
	t.Logf("Captured %d log scopes", len(recording))

	// Check for expected content
	contentFound := make([]bool, len(expectedContents))

	for scope, records := range recording {
		t.Logf("Scope: %+v, Records: %d", scope, len(records))
		for _, record := range records {
			// Check body content - extract from MapValue structure per events.go
			if record.Body.Kind() == log.KindMap {
				bodyMap := record.Body.AsMap()
				for _, kv := range bodyMap {
					if string(kv.Key) == "content" && kv.Value.Kind() == log.KindString {
						content := kv.Value.AsString()
						for i, expected := range expectedContents {
							if strings.Contains(content, expected) {
								contentFound[i] = true
							}
						}
					}
				}
			} else if record.Body.Kind() == log.KindString {
				bodyStr := record.Body.AsString()
				for i, expected := range expectedContents {
					if strings.Contains(bodyStr, expected) {
						contentFound[i] = true
					}
				}
			}

			// Check attributes for additional content
			for _, attr := range record.Attributes {
				var attrStr string
				switch attr.Value.Kind() {
				case log.KindString:
					attrStr = attr.Value.AsString()
				case log.KindMap:
					attrStr = fmt.Sprintf("%v", attr.Value.AsMap())
				default:
					continue
				}

				for i, expected := range expectedContents {
					if strings.Contains(attrStr, expected) {
						contentFound[i] = true
					}
				}

				// Also check for specific attribute names that might contain content
				key := string(attr.Key)
				if key == "body" || key == "content" || key == "message" || key == "text" {
					for i, expected := range expectedContents {
						if strings.Contains(attrStr, expected) {
							contentFound[i] = true
						}
					}
				}
			}
		}
	}

	// Assert expectations based on expected content indices
	// expectedContents[0] = user content, [1] = system content, [2] = output content
	if len(expectedContents) >= 3 {
		assert.Equal(t, tc.ExpectedUserContent, contentFound[0], "User content logging expectation mismatch")
		assert.Equal(t, tc.ExpectedSystemContent, contentFound[1], "System content logging expectation mismatch")
		assert.Equal(t, tc.ExpectedOutputContent, contentFound[2], "Output content logging expectation mismatch")
	}
}

// runContentLoggingTestTwoContent runs a content logging test case for APIs with input/output only (not user/system/output)
func runContentLoggingTestTwoContent(t *testing.T, options []Option, responseBody string, makeAPICall func(*openai.Client) error, expectedContents []string, expectedInput, expectedOutput bool) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Create test logger recorder to capture content
	logRecorder := logtest.NewRecorder()

	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	// Build middleware options with test logger
	middlewareOptions := append([]Option{
		WithLoggerProvider(logRecorder),
	}, options...)

	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client", middlewareOptions...)),
	)

	// Make API call
	err := makeAPICall(&client)
	require.NoError(t, err)

	// Verify span creation
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)

	// Verify logged content
	recording := logRecorder.Result()
	t.Logf("Captured %d log scopes", len(recording))

	// Check for expected content
	contentFound := make([]bool, len(expectedContents))

	for scope, records := range recording {
		t.Logf("Scope: %+v, Records: %d", scope, len(records))
		for _, record := range records {
			// Check body content - extract from MapValue structure per events.go
			if record.Body.Kind() == log.KindMap {
				bodyMap := record.Body.AsMap()
				for _, kv := range bodyMap {
					if string(kv.Key) == "content" && kv.Value.Kind() == log.KindString {
						content := kv.Value.AsString()
						for i, expected := range expectedContents {
							if strings.Contains(content, expected) {
								contentFound[i] = true
							}
						}
					}
				}
			} else if record.Body.Kind() == log.KindString {
				bodyStr := record.Body.AsString()
				for i, expected := range expectedContents {
					if strings.Contains(bodyStr, expected) {
						contentFound[i] = true
					}
				}
			}

			// Check attributes for additional content
			for _, attr := range record.Attributes {
				var attrStr string
				switch attr.Value.Kind() {
				case log.KindString:
					attrStr = attr.Value.AsString()
				case log.KindMap:
					attrStr = fmt.Sprintf("%v", attr.Value.AsMap())
				default:
					continue
				}

				for i, expected := range expectedContents {
					if strings.Contains(attrStr, expected) {
						contentFound[i] = true
					}
				}

				// Also check for specific attribute names that might contain content
				key := string(attr.Key)
				if key == "body" || key == "content" || key == "message" || key == "text" {
					for i, expected := range expectedContents {
						if strings.Contains(attrStr, expected) {
							contentFound[i] = true
						}
					}
				}
			}
		}
	}

	// Assert expectations based on expected content indices
	// expectedContents[0] = input content, [1] = output content
	if len(expectedContents) >= 2 {
		assert.Equal(t, expectedInput, contentFound[0], "Input content logging expectation mismatch")
		assert.Equal(t, expectedOutput, contentFound[1], "Output content logging expectation mismatch")
	}
}

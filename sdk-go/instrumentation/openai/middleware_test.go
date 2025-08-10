// Unit tests for Middleware function - tests middleware behavior with mocked dependencies.
// This file focuses on testing the middleware's core functionality including span creation,
// error handling, and operation detection without real HTTP calls.
package openai

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/openai/openai-go/option"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
)

func TestMiddleware_BasicSpanCreation(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	middleware := Middleware("test-client")
	req := httptest.NewRequest(http.MethodPost, "http://localhost/v1/chat/completions", nil)

	// Mock successful response
	var nextFunc option.MiddlewareNext = func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       http.NoBody,
		}, nil
	}

	resp, err := middleware(req, nextFunc)
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify span was created
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	// Span name is based on system + path.Base() of URL
	assert.Equal(t, "openai.completions", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)
}

func TestMiddleware_ErrorHandling(t *testing.T) {
	tests := []struct {
		name           string
		nextError      error
		response       *http.Response
		expectedStatus codes.Code
	}{
		{
			name:           "Network error",
			nextError:      errors.New("network error"),
			response:       nil,
			expectedStatus: codes.Error,
		},
		{
			name:      "HTTP error with response",
			nextError: errors.New("API error"),
			response: &http.Response{
				StatusCode: http.StatusBadRequest,
				Body:       http.NoBody,
			},
			expectedStatus: codes.Error,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			exporter, cleanup := setupTestTracing(t)
			defer cleanup()

			middleware := Middleware("test-client")
			req := httptest.NewRequest(http.MethodPost, "http://localhost/v1/chat/completions", nil)

			var nextFunc option.MiddlewareNext = func(req *http.Request) (*http.Response, error) {
				return tt.response, tt.nextError
			}

			_, err := middleware(req, nextFunc)
			assert.Error(t, err)
			assert.Equal(t, tt.nextError, err)

			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			span := spans[0]

			assert.Equal(t, tt.expectedStatus, span.Status.Code)
		})
	}
}

func TestMiddleware_OperationDetection(t *testing.T) {
	tests := []struct {
		path         string
		expectedName string
		expectedOp   string
	}{
		{"/v1/chat/completions", "openai.completions", "chat"},
		{"/v1/completions", "openai.completions", "text_completion"},
		{"/v1/embeddings", "openai.embeddings", "embeddings"},
		{"/v1/responses", "openai.responses", "responses"},
		{"/v1/unknown", "openai.unknown", "unknown"},
		{"/some/random/path", "openai.path", "chat"}, // path.Base() returns last segment, operation defaults to chat
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			exporter, cleanup := setupTestTracing(t)
			defer cleanup()

			middleware := Middleware("test-client")
			req := httptest.NewRequest(http.MethodPost, "http://localhost"+tt.path, nil)

			var nextFunc option.MiddlewareNext = func(req *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: http.StatusOK, Body: http.NoBody}, nil
			}

			_, err := middleware(req, nextFunc)
			require.NoError(t, err)

			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			span := spans[0]

			assert.Equal(t, tt.expectedName, span.Name)

			// Check operation attribute
			opValue, found := findAttr(span.Attributes, semconv.GenAIOperationNameKey)
			require.True(t, found)
			assert.Equal(t, tt.expectedOp, opValue.AsString())
		})
	}
}

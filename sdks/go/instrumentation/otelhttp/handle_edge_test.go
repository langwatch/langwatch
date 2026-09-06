package otelhttp

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/codes"
)

func respond(status int, contentType, body string) func(*http.Request) (*http.Response, error) {
	return func(*http.Request) (*http.Response, error) {
		h := http.Header{}
		if contentType != "" {
			h.Set("Content-Type", contentType)
		}
		var b io.ReadCloser = http.NoBody
		if body != "" {
			b = io.NopCloser(strings.NewReader(body))
		}
		return &http.Response{StatusCode: status, Header: h, Body: b}, nil
	}
}

func TestHandleHTTPErrorStatus(t *testing.T) {
	t.Run("a 4xx sets an error status and skips response extraction", func(t *testing.T) {
		hits := 0
		reqCalled := false
		ext := &fakeExtractor{matchedReq: true, matchedResp: true, reqCalled: &reqCalled, nonStreamHits: &hits}
		tr, exp := newTracer(t, ext)

		req := httptest.NewRequest(http.MethodPost, "https://api.test/v1/chat/completions", strings.NewReader(`{"model":"m"}`))
		resp, err := tr.Handle(req, respond(http.StatusTooManyRequests, "application/json", `{"error":"x"}`))
		require.NoError(t, err)
		_, _ = io.ReadAll(resp.Body)
		_ = resp.Body.Close()

		spans := exp.GetSpans()
		require.Len(t, spans, 1)
		assert.Equal(t, codes.Error, spans[0].Status.Code)
		assert.True(t, reqCalled, "request is still recorded on error")
		assert.Equal(t, 0, hits, "no response extraction on 4xx")
	})
}

func TestHandleNonJSON(t *testing.T) {
	t.Run("a non-JSON 200 records the request but not the body", func(t *testing.T) {
		hits := 0
		reqCalled := false
		ext := &fakeExtractor{matchedReq: true, matchedResp: true, reqCalled: &reqCalled, nonStreamHits: &hits}
		tr, exp := newTracer(t, ext)

		req := httptest.NewRequest(http.MethodPost, "https://api.test/v1/x", strings.NewReader(`{"model":"m"}`))
		resp, err := tr.Handle(req, respond(http.StatusOK, "text/plain", "hello"))
		require.NoError(t, err)
		_, _ = io.ReadAll(resp.Body)
		_ = resp.Body.Close()

		spans := exp.GetSpans()
		require.Len(t, spans, 1)
		assert.True(t, reqCalled)
		assert.Equal(t, 0, hits, "no response extraction for a non-JSON body")
	})
}

func TestHandleNoResponseBody(t *testing.T) {
	t.Run("an empty response body still records the request and ends the span", func(t *testing.T) {
		reqCalled := false
		ext := &fakeExtractor{matchedReq: true, reqCalled: &reqCalled}
		tr, exp := newTracer(t, ext)

		req := httptest.NewRequest(http.MethodPost, "https://api.test/v1/x", strings.NewReader(`{"model":"m"}`))
		_, err := tr.Handle(req, respond(http.StatusOK, "application/json", ""))
		require.NoError(t, err)

		spans := exp.GetSpans()
		require.Len(t, spans, 1)
		assert.True(t, reqCalled)
	})
}

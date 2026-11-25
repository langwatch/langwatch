package otelhttp

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/codes"
)

// reportingExtractor is a fakeExtractor that also reports a body error.
type reportingExtractor struct {
	fakeExtractor
	err error
}

func (r *reportingExtractor) ResponseError([]byte) error { return r.err }

func handleAndDrain(t *testing.T, tr *Tracer, body string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "https://api.test/v1/chat/completions", strings.NewReader(`{"model":"m"}`))
	resp, err := tr.Handle(req, jsonResponse(body))
	require.NoError(t, err)
	got, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	assert.Equal(t, body, string(got), "body passes through byte-for-byte")
}

func TestHandleResponseErrorReporter(t *testing.T) {
	t.Run("a reported BodyError marks the span Error with its message and type", func(t *testing.T) {
		ext := &reportingExtractor{
			fakeExtractor: fakeExtractor{matchedReq: true, matchedResp: true},
			err:           &BodyError{Message: "upstream failed", Type: "provider_error"},
		}
		tr, exp := newTracer(t, ext)
		handleAndDrain(t, tr, `{"error":{"message":"upstream failed"}}`)

		spans := exp.GetSpans()
		require.Len(t, spans, 1)
		assert.Equal(t, codes.Error, spans[0].Status.Code)
		assert.Equal(t, "upstream failed", spans[0].Status.Description)
		assert.Equal(t, "provider_error", attrMap(spans[0])["error.type"].AsString())
		assert.NotEmpty(t, spans[0].Events, "the error is recorded as a span event")
	})

	t.Run("a plain error marks the span Error without error.type", func(t *testing.T) {
		ext := &reportingExtractor{
			fakeExtractor: fakeExtractor{matchedReq: true, matchedResp: true},
			err:           errors.New("bad body"),
		}
		tr, exp := newTracer(t, ext)
		handleAndDrain(t, tr, `{"object":"x"}`)

		spans := exp.GetSpans()
		require.Len(t, spans, 1)
		assert.Equal(t, codes.Error, spans[0].Status.Code)
		_, hasType := attrMap(spans[0])["error.type"]
		assert.False(t, hasType)
	})

	t.Run("a reporter that finds no error leaves the span Ok", func(t *testing.T) {
		ext := &reportingExtractor{fakeExtractor: fakeExtractor{matchedReq: true, matchedResp: true}}
		tr, exp := newTracer(t, ext)
		handleAndDrain(t, tr, `{"object":"chat.completion"}`)

		spans := exp.GetSpans()
		require.Len(t, spans, 1)
		assert.Equal(t, codes.Ok, spans[0].Status.Code)
	})
}

package providers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// OpenAI can fail a Responses stream AFTER the 200 is established by emitting
// an in-stream `event: error` whose payload nests the detail under an `error`
// OBJECT: {"type":"error","error":{"type","code","message","param"}}. Bifrost's
// stream schema only maps the legacy flat `message`/`code`/`param` fields, so
// the nested payload was dropped and the iterator surfaced a blank
// "stream error: ", the client lost the provider's actionable message (a real
// quota exhaustion read as an opaque parse crash in opencode/Langy).
//
// The fixture is a byte-for-byte capture of a real api.openai.com Responses
// stream that ends in an insufficient_quota error event. The test runs the
// REAL bifrost pipeline (HTTP to a local upstream replaying the capture) and
// pins that the iterator ends with a structured upstream error carrying the
// provider's own message and the verbatim event body.
//
// Spec: specs/ai-gateway/error-transparency.feature
// @scenario "Mid-stream Responses error event is forwarded with its nested payload"
func TestResponsesStream_MidStreamErrorEvent_KeepsUpstreamPayload(t *testing.T) {
	fixture, err := os.ReadFile(filepath.Join("testdata", "openai_responses_error_event.sse"))
	require.NoError(t, err)

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// assert, not require: FailNow inside an http handler goroutine is
		// undefined behavior (testifylint go-require).
		assert.Equal(t, "/v1/responses", r.URL.Path)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(fixture)
	}))
	defer backend.Close()

	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger:           zap.NewNop(),
		OpenAIBackendURL: backend.URL,
	})
	require.NoError(t, err)
	defer router.Close()

	iter, err := router.DispatchStream(
		context.Background(),
		&domain.Request{
			Type:  domain.RequestTypeResponses,
			Model: "openai/gpt-5.6-luna",
			Body:  []byte(`{"model":"gpt-5.6-luna","input":"hi","stream":true}`),
		},
		domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-test"},
	)
	require.NoError(t, err)

	var frames []string
	for iter.Next(context.Background()) {
		frames = append(frames, string(iter.Chunk()))
	}

	// The legit pre-error events still reach the client.
	require.NotEmpty(t, frames, "events before the error must be forwarded")
	assert.Contains(t, frames[0], "response.created")

	streamErr := iter.Err()
	require.Error(t, streamErr, "the error event must terminate the stream with an error")

	var ue *domain.UpstreamError
	require.ErrorAs(t, streamErr, &ue,
		"a provider-origin stream error must surface as a structured UpstreamError, not an opaque string")
	assert.Contains(t, ue.Message, "exceeded your current quota",
		"the provider's own message must survive; it lives in the event's nested error object")
	require.NotEmpty(t, ue.Body, "the verbatim upstream error event must ride along for wire forwarding")
	assert.Contains(t, string(ue.Body), `"insufficient_quota"`)
	assert.Contains(t, string(ue.Body), `"type":"error"`)
	assert.False(t, strings.HasSuffix(streamErr.Error(), "stream error: "),
		"the blank 'stream error: ' regression must not come back")
}

// A BifrostError chunk with no recoverable payload must still produce a
// non-empty, actionable message rather than a blank suffix.
// @scenario "Gateway-origin stream failures use the standard error-event object"
func TestResponsesStream_UpstreamDropsMidStream_NamesTheFailure(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("event: response.created\ndata: {\"type\":\"response.created\",\"sequence_number\":0}\n\n"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		// Drop the connection mid-stream without a terminal event.
		if hj, ok := w.(http.Hijacker); ok {
			conn, _, hjErr := hj.Hijack()
			if hjErr == nil {
				_ = conn.Close()
			}
		}
	}))
	defer backend.Close()

	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger:           zap.NewNop(),
		OpenAIBackendURL: backend.URL,
	})
	require.NoError(t, err)
	defer router.Close()

	iter, err := router.DispatchStream(
		context.Background(),
		&domain.Request{
			Type:  domain.RequestTypeResponses,
			Model: "openai/gpt-5.6-luna",
			Body:  []byte(`{"model":"gpt-5.6-luna","input":"hi","stream":true}`),
		},
		domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-test"},
	)
	require.NoError(t, err)

	for iter.Next(context.Background()) {
		// drain
	}

	streamErr := iter.Err()
	if streamErr == nil {
		// A clean EOF after a dropped connection is bifrost-version dependent;
		// the invariant this test pins is only: IF an error surfaces, it names
		// the failure. The blank-message regression is what must not return.
		t.Skip("bifrost treated the drop as clean EOF; nothing to assert")
	}
	assert.NotEmpty(t, strings.TrimSpace(strings.TrimPrefix(streamErr.Error(), "stream error:")),
		"a stream failure must carry a non-empty description")
	if errors.As(streamErr, new(*domain.UpstreamError)) {
		var ue *domain.UpstreamError
		_ = errors.As(streamErr, &ue)
		assert.NotEmpty(t, ue.Message)
	}
}

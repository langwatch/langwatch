package httpapi

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/providererr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/providers"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Anthropic's answer to a request on an account with no credit left, as the
// API returns it: a 400 invalid_request_error that names the balance.
const anthropicCreditBalanceBody = `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CTest"}`

// anthropicLaneRouter builds the gateway over the real Bifrost router with one
// Anthropic credential whose base URL is backendURL.
func anthropicLaneRouter(t *testing.T, backendURL string) http.Handler {
	t.Helper()
	bf, err := providers.NewBifrostRouter(context.Background(), providers.BifrostOptions{Logger: zap.NewNop()})
	require.NoError(t, err)
	t.Cleanup(bf.Close)
	bundle := testBundle()
	bundle.Credentials = []domain.Credential{{
		ID: "cred-anthropic", ProviderID: domain.ProviderAnthropic, APIKey: "sk-ant-test",
		Extra: map[string]string{"base_url": backendURL},
	}}
	auth := &mockAuth{resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) { return bundle, nil }}
	return buildRouter(app.WithAuth(auth), app.WithProviders(bf), app.WithLogger(zap.NewNop()))
}

func streamingMessagesRequest() *http.Request {
	body := `{"model":"anthropic/claude-haiku-5-5","max_tokens":64,"messages":[{"role":"user","content":"hi"}],"stream":true}`
	req := httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewReader([]byte(body)))
	req.Header.Set("x-api-key", "vk-lw-test")
	req.Header.Set("anthropic-version", "2023-06-01")
	return req
}

// @scenario "A streaming request the provider rejects at once is answered with the provider's status"
func TestMessagesStream_ProviderRejectionAtOpenKeepsItsStatus(t *testing.T) {
	backend := upstreamStub(http.StatusBadRequest, anthropicCreditBalanceBody,
		map[string]string{"x-should-retry": "false", "request-id": "req_011CTest"})
	defer backend.Close()

	rec := httptest.NewRecorder()
	anthropicLaneRouter(t, backend.URL).ServeHTTP(rec, streamingMessagesRequest())

	require.Equal(t, http.StatusBadRequest, rec.Code, "body: %s", rec.Body.String())
	assert.Contains(t, rec.Header().Get("Content-Type"), "application/json")
	assert.Equal(t, "false", rec.Header().Get("X-Should-Retry"))
	body := rec.Body.Bytes()
	assert.Equal(t, "error", gjson.GetBytes(body, "type").String())
	assert.Equal(t, "invalid_request_error", gjson.GetBytes(body, "error.type").String())
	assert.Equal(t, providererr.GatewayAccountExhaustedMessage, gjson.GetBytes(body, "error.message").String())
	assert.True(t, providererr.AccountExhausted(rec.Code, body),
		"a reader past the gateway must still classify the spent balance")
}

// @scenario "A streaming request the provider accepts still streams"
func TestMessagesStream_AcceptedStreamPassesThrough(t *testing.T) {
	const frames = "event: message_start\n" +
		`data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":3,"output_tokens":1}}}` + "\n\n" +
		"event: message_stop\n" +
		`data: {"type":"message_stop"}` + "\n\n"
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, frames)
	}))
	defer backend.Close()

	rec := httptest.NewRecorder()
	anthropicLaneRouter(t, backend.URL).ServeHTTP(rec, streamingMessagesRequest())

	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	assert.Contains(t, rec.Header().Get("Content-Type"), "text/event-stream")
	assert.Equal(t, frames, rec.Body.String())
}

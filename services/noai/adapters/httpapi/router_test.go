package httpapi_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/noai/adapters/httpapi"
)

func newTestRouter() http.Handler {
	reg := health.New("test")
	reg.MarkStarted()
	return httpapi.NewRouter(httpapi.RouterDeps{
		Logger: zap.NewNop(),
		Health: reg,
	})
}

func TestHealthzReturnsOK(t *testing.T) {
	r := newTestRouter()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	assert.Equal(t, http.StatusOK, rec.Code)
}

/** @scenario "/v1/models lists the eight fake models" */
func TestListModelsReturnsEveryModel(t *testing.T) {
	r := newTestRouter()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/models", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var resp struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Len(t, resp.Data, 8)
	for _, entry := range resp.Data {
		assert.True(t, strings.HasPrefix(entry.ID, "langwatch_noai/"))
	}
}

func TestChatCompletionsEchoText(t *testing.T) {
	r := newTestRouter()
	body := []byte(`{
		"model": "langwatch_noai/echo-text",
		"messages": [{"role":"user","content":"hello"}]
	}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	r.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
				Audio   any    `json:"audio"`
			} `json:"message"`
		} `json:"choices"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, `Fake LLM Response to: "hello"`, resp.Choices[0].Message.Content)
	assert.Nil(t, resp.Choices[0].Message.Audio)
}

/** @scenario "streaming chat completions emit SSE chunks ending with [DONE]" */
func TestChatCompletionsStreamEmitsDoneSentinel(t *testing.T) {
	r := newTestRouter()
	body := []byte(`{
		"model": "langwatch_noai/echo-text",
		"messages": [{"role":"user","content":"hi"}],
		"stream": true
	}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	r.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "text/event-stream", rec.Header().Get("Content-Type"))

	scanner := bufio.NewScanner(rec.Body)
	sawDelta := false
	sawDone := false
	for scanner.Scan() {
		line := scanner.Text()
		// SSE data lines carry JSON, so the inner quote characters are
		// backslash-escaped (`\"hi\"`). Match the unquoted prefix instead.
		if strings.Contains(line, "Fake LLM Response to:") {
			sawDelta = true
		}
		if line == "data: [DONE]" {
			sawDone = true
		}
	}
	require.NoError(t, scanner.Err())
	assert.True(t, sawDelta, "stream must include the echo content delta")
	assert.True(t, sawDone, "stream must end with data: [DONE]")
}

/** @scenario "/v1/responses returns the Responses-API shape" */
func TestResponsesEchoText(t *testing.T) {
	r := newTestRouter()
	body := []byte(`{"model":"langwatch_noai/echo-text","input":"hello"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	r.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		Output     []map[string]any `json:"output"`
		OutputText string           `json:"output_text"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, `Fake LLM Response to: "hello"`, resp.OutputText)
	require.Len(t, resp.Output, 1)
}

/** @scenario "streaming responses emit typed events ending with response.completed" */
func TestResponsesStreamReturnsSSEWithEvents(t *testing.T) {
	r := newTestRouter()
	body := []byte(`{"model":"langwatch_noai/echo-audio","input":"hi","stream":true}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	r.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	body2 := rec.Body.String()
	assert.Contains(t, body2, "event: response.created")
	assert.Contains(t, body2, "event: response.output_text.delta")
	assert.Contains(t, body2, "event: response.output_audio.delta")
	assert.Contains(t, body2, "event: response.completed")
}

/** @scenario "request without a model is rejected with a 400 error" */
func TestRejectsMissingModel(t *testing.T) {
	r := newTestRouter()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
		bytes.NewReader([]byte(`{"messages":[{"role":"user","content":"x"}]}`)))
	r.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	scenario "github.com/langwatch/scenario/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInferenceGoesThroughTheProxyWithTheRolesParams(t *testing.T) {
	var headers http.Header
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/go/proxy/v1/chat/completions", r.URL.Path)
		headers = r.Header.Clone()
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"hello"}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}`))
	}))
	defer srv.Close()
	c := New(Options{Params: map[string]string{"model": "openai/gpt-5-mini", "api_key": "sk-x", "api_base": "https://b"}, NLPServiceURL: srv.URL, Secret: " s3cret "})

	res, err := c.Inference(context.Background(), scenario.InferenceParams{Messages: []scenario.Message{scenario.UserMsg("hi")}})
	require.NoError(t, err)
	assert.Equal(t, "hello", res.Message.Text())
	assert.Equal(t, int64(3), res.Usage.InputTokens)
	assert.Equal(t, "Bearer sk-x", headers.Get("Authorization"))
	assert.Equal(t, "openai/gpt-5-mini", headers.Get("x-litellm-model"))
	assert.Equal(t, "https://b", headers.Get("x-litellm-api_base"))
	assert.Equal(t, "s3cret", headers.Get(SecretHeader))
	assert.Equal(t, "openai/gpt-5-mini", body["model"])
}

func TestInferenceRetriesWithReasoningOffWhenTheProviderAsks(t *testing.T) {
	var efforts []any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		efforts = append(efforts, body["reasoning_effort"])
		if body["reasoning_effort"] == nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"Function tools are not supported with reasoning; set reasoning_effort to 'none'","param":"reasoning_effort"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":null,"tool_calls":[{"id":"c","function":{"name":"finish_test","arguments":"{}"}}]}}]}`))
	}))
	defer srv.Close()
	c := New(Options{Params: map[string]string{"model": "openai/gpt-5"}, NLPServiceURL: srv.URL})

	res, err := c.Inference(context.Background(), scenario.InferenceParams{
		Messages: []scenario.Message{scenario.UserMsg("judge")},
		Tools:    []scenario.ToolDefinition{{Name: "finish_test", Parameters: map[string]any{"type": "object"}}},
	})
	require.NoError(t, err)
	assert.Equal(t, []any{nil, "none"}, efforts)
	assert.Equal(t, "finish_test", res.Message.ToolCalls[0].Name)
}

func TestJudgeTurnsReasoningOffUpFrontForKnownModels(t *testing.T) {
	assert.Equal(t, "none", NewJudge(Options{Params: map[string]string{"model": "openai/gpt-5.6-sol"}}).reasoningEffort)
	assert.Empty(t, NewJudge(Options{Params: map[string]string{"model": "openai/gpt-5"}}).reasoningEffort)
}

func TestInferenceReportsTheProvidersOwnMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"Incorrect API key provided.","type":"provider_error"}}`))
	}))
	defer srv.Close()
	c := New(Options{Params: map[string]string{"model": "openai/gpt-5"}, NLPServiceURL: srv.URL})

	_, err := c.Inference(context.Background(), scenario.InferenceParams{Messages: []scenario.Message{scenario.UserMsg("hi")}})
	require.EqualError(t, err, "Incorrect API key provided.")
}

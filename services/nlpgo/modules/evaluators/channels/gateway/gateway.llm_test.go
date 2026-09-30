package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

func tenant(env map[string]string) contract.Tenant {
	return contract.Tenant{ProjectID: "project_acme", Env: env}
}

func chat(env map[string]string, model string) channels.CompletionRequest {
	return channels.CompletionRequest{
		Tenant:   tenant(env),
		Model:    model,
		Messages: []channels.Message{{Role: "user", Content: "is this faithful?"}},
	}
}

func decodeBody(t *testing.T, call dispatcher.Request) map[string]any {
	t.Helper()
	var body map[string]any
	require.NoError(t, json.Unmarshal(call.Body, &body))
	return body
}

func TestCompletionCredentialsComeOnlyFromTenantEnv(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-process")
	t.Setenv("X_LITELLM_api_key", "sk-process")

	t.Run("a process key is never used", func(t *testing.T) {
		_, err := buildCompletion(chat(nil, "openai/gpt-5-mini"))
		require.ErrorIs(t, err, channels.ErrProviderNotConfigured)
	})
	t.Run("an operator key in the env is not a chat credential", func(t *testing.T) {
		_, err := buildCompletion(chat(map[string]string{"OPENAI_API_KEY": "sk-operator"}, "openai/gpt-5-mini"))
		require.ErrorIs(t, err, channels.ErrProviderNotConfigured)
	})
	t.Run("the embeddings block is not a chat credential", func(t *testing.T) {
		_, err := buildCompletion(chat(map[string]string{"X_LITELLM_EMBEDDINGS_api_key": "sk-embed"}, "openai/gpt-5-mini"))
		require.ErrorIs(t, err, channels.ErrProviderNotConfigured)
	})
	t.Run("the tenant's X_LITELLM_ params are", func(t *testing.T) {
		call, err := buildCompletion(chat(map[string]string{"X_LITELLM_api_key": "sk-tenant"}, "openai/gpt-5-mini"))
		require.NoError(t, err)
		assert.Equal(t, "sk-tenant", call.Credential.APIKey)
		assert.Equal(t, "gpt-5-mini", call.Model)
		assert.Equal(t, "gpt-5-mini", decodeBody(t, call)["model"])
	})
}

func TestEmbeddingsUseTheEmbeddingsParams(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-process")
	request := func(env map[string]string) channels.EmbeddingRequest {
		return channels.EmbeddingRequest{Tenant: tenant(env), Model: "openai/text-embedding-3-small", Inputs: []string{"a", "b"}}
	}

	t.Run("the embeddings block wins over the chat block", func(t *testing.T) {
		call, err := buildEmbedding(request(map[string]string{
			"X_LITELLM_api_key":            "sk-chat",
			"X_LITELLM_EMBEDDINGS_api_key": "sk-embed",
		}))
		require.NoError(t, err)
		assert.Equal(t, "sk-embed", call.Credential.APIKey)
		assert.Equal(t, []any{"a", "b"}, decodeBody(t, call)["input"])
	})
	t.Run("the provider's named env key is the fallback", func(t *testing.T) {
		call, err := buildEmbedding(request(map[string]string{"OPENAI_API_KEY": "sk-install"}))
		require.NoError(t, err)
		assert.Equal(t, "sk-install", call.Credential.APIKey)
	})
	t.Run("nothing in the env is not configured", func(t *testing.T) {
		_, err := buildEmbedding(request(nil))
		require.ErrorIs(t, err, channels.ErrProviderNotConfigured)
	})
}

func TestCompletionAppliesTheStudioModelRules(t *testing.T) {
	zero := 0.0
	req := chat(map[string]string{"X_LITELLM_api_key": "sk-tenant"}, "openai/o3-mini")
	req.Temperature = &zero

	call, err := buildCompletion(req)
	require.NoError(t, err)
	body := decodeBody(t, call)
	assert.InDelta(t, 1.0, body["temperature"], 0)
	assert.GreaterOrEqual(t, body["max_completion_tokens"], float64(16000))
}

func TestParseCompletionMapsChoicesAndUsage(t *testing.T) {
	out, err := parseCompletion([]byte(`{"choices":[{"message":{"content":null,"tool_calls":[{"function":{"name":"verdict","arguments":"{\"passed\":true}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":12,"completion_tokens":3}}`))
	require.NoError(t, err)
	require.Len(t, out.Choices, 1)
	assert.Equal(t, []channels.ToolCall{{Name: "verdict", Arguments: `{"passed":true}`}}, out.Choices[0].ToolCalls)
	assert.Equal(t, "tool_calls", out.Choices[0].FinishReason)
	assert.Equal(t, channels.Usage{PromptTokens: 12, CompletionTokens: 3}, out.Usage)
}

// @scenario "A custom provider endpoint cannot reach the internal network"
func TestCustomProviderAtAPrivateAddressIsRefused(t *testing.T) {
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(upstream.Close)

	disp, err := dispatcher.New(t.Context(), dispatcher.Options{BlockLocalHTTPCalls: true})
	require.NoError(t, err)
	t.Cleanup(disp.Close)

	channel := New(Options{Dispatcher: disp})
	_, err = channel.Complete(t.Context(), chat(map[string]string{
		"X_LITELLM_api_key":  "sk-acme",
		"X_LITELLM_api_base": upstream.URL + "/v1",
	}, "custom/acme-judge"))

	require.Error(t, err)
	assert.Zero(t, hits.Load(), "the call must be refused before it leaves the runtime")
}

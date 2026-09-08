package providers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// @scenario "Azure deployment requests retain configured and default API versions"
func TestAzureCompatibility_DeploymentURLs(t *testing.T) {
	for _, version := range []string{"", "2025-04-01-preview"} {
		t.Run("version="+version, func(t *testing.T) {
			for _, typ := range []domain.RequestType{domain.RequestTypeChat, domain.RequestTypeEmbeddings, domain.RequestTypeSpeech, domain.RequestTypeTranscription} {
				t.Run(string(typ), func(t *testing.T) { runAzureDeploymentCase(t, typ, version) })
			}
		})
	}
}

func runAzureDeploymentCase(t *testing.T, typ domain.RequestType, version string) {
	t.Helper()
	expectedVersion := version
	if expectedVersion == "" {
		expectedVersion = "2024-10-21"
	}
	backend := httptest.NewServer(azureDeploymentHandler(t, typ, expectedVersion))
	defer backend.Close()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10})
	require.NoError(t, err)
	defer router.Close()
	extra := map[string]string{"api_base": backend.URL}
	if version != "" {
		extra["api_version"] = version
	}
	cred := domain.Credential{ID: "azure", ProviderID: domain.ProviderAzure, APIKey: "azure-test-key", Extra: extra, DeploymentMap: map[string]string{"gpt-test": "customer-deployment"}}
	req := &domain.Request{Type: typ, Model: "gpt-test", Body: []byte(`{"model":"azure/gpt-test","messages":[{"role":"user","content":"hi"}],"input":"hello","voice":"alloy","drop_tuning_params":true}`), Transcription: &domain.TranscriptionUpload{File: []byte("audio bytes"), Filename: "test.wav", Params: map[string]string{"language": "en"}}}
	resp, err := router.Dispatch(context.Background(), req, cred)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	assertAzureDeploymentResponse(t, typ, resp)
}

func azureDeploymentHandler(t *testing.T, typ domain.RequestType, expectedVersion string) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/openai/deployments/customer-deployment/"+map[domain.RequestType]string{domain.RequestTypeChat: "chat/completions", domain.RequestTypeEmbeddings: "embeddings", domain.RequestTypeSpeech: "audio/speech", domain.RequestTypeTranscription: "audio/transcriptions"}[typ], r.URL.Path)
		assert.Equal(t, expectedVersion, r.URL.Query().Get("api-version"))
		assert.Equal(t, "azure-test-key", r.Header.Get("api-key"))
		assertAzureDeploymentRequestBody(t, w, r)
		w.Header().Set("Content-Type", "application/json")
		switch typ {
		default:
			t.Fatalf("unexpected request type %s", typ)
		case domain.RequestTypeChat:
			_, _ = io.WriteString(w, `{"id":"chat-test","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}`)
		case domain.RequestTypeEmbeddings:
			_, _ = io.WriteString(w, `{"object":"list","data":[{"index":0,"object":"embedding","embedding":[0.1]}],"usage":{"prompt_tokens":7,"total_tokens":7}}`)
		case domain.RequestTypeSpeech:
			_, _ = io.WriteString(w, "audio result")
		case domain.RequestTypeTranscription:
			_, _ = io.WriteString(w, `{"text":"hello","usage":{"type":"duration","seconds":3}}`)
		}
	})
}

func assertAzureDeploymentRequestBody(t *testing.T, w http.ResponseWriter, r *http.Request) {
	t.Helper()
	if strings.HasSuffix(r.URL.Path, "audio/transcriptions") {
		r.Body = http.MaxBytesReader(w, r.Body, 1024*1024)
		assert.NoError(t, r.ParseMultipartForm(1024))
		assert.Equal(t, "customer-deployment", r.MultipartForm.Value["model"][0])
		assert.Equal(t, "en", r.MultipartForm.Value["language"][0])
		file, _, err := r.FormFile("file")
		if assert.NoError(t, err) {
			content, readErr := io.ReadAll(file)
			assert.NoError(t, readErr)
			assert.Equal(t, "audio bytes", string(content))
			_ = file.Close()
		}
	} else {
		body, err := io.ReadAll(r.Body)
		assert.NoError(t, err)
		assert.Equal(t, "customer-deployment", gjson.GetBytes(body, "model").String())
		assert.False(t, gjson.GetBytes(body, "drop_tuning_params").Exists())
	}
}

func assertAzureDeploymentResponse(t *testing.T, typ domain.RequestType, resp *domain.Response) {
	t.Helper()
	switch typ {
	default:
		t.Fatalf("unexpected request type %s", typ)
	case domain.RequestTypeChat:
		assert.Equal(t, 10, resp.Usage.TotalTokens)
		assert.Equal(t, "ok", gjson.GetBytes(resp.Body, "choices.0.message.content").String())
	case domain.RequestTypeEmbeddings:
		assert.Equal(t, 7, resp.Usage.PromptTokens)
		assert.Equal(t, "gpt-test", gjson.GetBytes(resp.Body, "model").String())
	case domain.RequestTypeSpeech:
		assert.Equal(t, "audio result", string(resp.Body))
		assert.Equal(t, "audio/mpeg", resp.Headers["Content-Type"])
		assert.Equal(t, 5, resp.Usage.InputChars)
	case domain.RequestTypeTranscription:
		assert.InDelta(t, 3.0, resp.Usage.AudioSeconds, 0.001)
		assert.Equal(t, "hello", gjson.GetBytes(resp.Body, "text").String())
	}
}

// @scenario "Azure chat streams retain role repair and token usage"
func TestAzureCompatibility_Stream(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/openai/deployments/deployment/chat/completions", r.URL.Path)
		assert.Equal(t, "2024-10-21", r.URL.Query().Get("api-version"))
		body, err := io.ReadAll(r.Body)
		assert.NoError(t, err)
		assert.True(t, gjson.GetBytes(body, "stream_options.include_usage").Bool())
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"id\":\"chat-test\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"}}]}\n\n")
		w.(http.Flusher).Flush()
		_, _ = io.WriteString(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":3,\"total_tokens\":10}}\n\ndata: [DONE]\n\n")
	}))
	defer backend.Close()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10})
	require.NoError(t, err)
	defer router.Close()
	iter, err := router.DispatchStream(context.Background(), &domain.Request{Type: domain.RequestTypeChat, Model: "gpt-test", Body: []byte(`{"model":"gpt-test","messages":[],"stream":true}`)}, domain.Credential{ID: "azure", ProviderID: domain.ProviderAzure, APIKey: "key", Extra: map[string]string{"endpoint": backend.URL}, DeploymentMap: map[string]string{"gpt-test": "deployment"}})
	require.NoError(t, err)
	defer iter.Close()
	require.True(t, iter.Next(context.Background()))
	assert.Equal(t, "assistant", gjson.GetBytes(iter.Chunk(), "choices.0.delta.role").String())
	assert.Equal(t, "hello", gjson.GetBytes(iter.Chunk(), "choices.0.delta.content").String())
	assert.Equal(t, "gpt-test", gjson.GetBytes(iter.Chunk(), "model").String())
	assert.Equal(t, "chat.completion.chunk", gjson.GetBytes(iter.Chunk(), "object").String())
	assert.Positive(t, gjson.GetBytes(iter.Chunk(), "created").Int())
	for iter.Next(context.Background()) {
		assert.Equal(t, "gpt-test", gjson.GetBytes(iter.Chunk(), "model").String())
	}
	require.NoError(t, iter.Err())
	assert.Equal(t, 10, iter.Usage().TotalTokens)
}

// @scenario "Azure provider errors preserve native status and body"
func TestAzureCompatibility_ProviderError(t *testing.T) {
	const body = `{"error":{"code":"DeploymentNotFound","message":"unknown deployment"}}`
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Retry-After", "2")
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, body)
	}))
	defer backend.Close()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10})
	require.NoError(t, err)
	defer router.Close()
	response, err := router.Dispatch(context.Background(), &domain.Request{Type: domain.RequestTypeChat, Model: "gpt-test", Body: []byte(`{"model":"gpt-test","messages":[]}`)}, domain.Credential{ID: "azure", ProviderID: domain.ProviderAzure, APIKey: "key", Extra: map[string]string{"endpoint": backend.URL}, DeploymentMap: map[string]string{"gpt-test": "deployment"}})
	require.NoError(t, err)
	assert.Equal(t, http.StatusNotFound, response.StatusCode)
	assert.JSONEq(t, body, string(response.Body))
	assert.Equal(t, "2", response.Headers["Retry-After"])
}

func TestCredentialToBifrostKey_ModelAllowanceAndAliases(t *testing.T) {
	for _, provider := range []bfschemas.ModelProvider{bfschemas.Azure, bfschemas.Bedrock, bfschemas.OpenAI} {
		key := credentialToBifrostKey(domain.Credential{ID: "key", DeploymentMap: map[string]string{"model": "deployment"}}, provider, nil)
		assert.True(t, key.Models.IsAllowed("model"))
		if provider == bfschemas.OpenAI {
			assert.Empty(t, key.Aliases)
		} else {
			assert.Equal(t, "deployment", key.Aliases["model"])
		}
	}
}

// @scenario "Azure chat keeps Claude deployment routing"
func TestAzureCompatibility_ClaudeDeploymentUsesAnthropic(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/anthropic/v1/messages", r.URL.Path)
		assert.Empty(t, r.URL.RawQuery)
		assert.NotEmpty(t, r.Header.Get("anthropic-version"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"msg-test","type":"message","role":"assistant","model":"claude-sonnet-4","content":[{"type":"text","text":"hello"}],"stop_reason":"end_turn","usage":{"input_tokens":7,"output_tokens":3}}`)
	}))
	defer backend.Close()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10})
	require.NoError(t, err)
	defer router.Close()
	response, err := router.Dispatch(context.Background(), &domain.Request{Type: domain.RequestTypeChat, Model: "my-model", Body: []byte(`{"model":"my-model","messages":[{"role":"user","content":"hello"}]}`)}, domain.Credential{ID: "azure", ProviderID: domain.ProviderAzure, APIKey: "key", Extra: map[string]string{"endpoint": backend.URL}, DeploymentMap: map[string]string{"my-model": "claude-sonnet-4"}})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, response.StatusCode)
	assert.Equal(t, "hello", gjson.GetBytes(response.Body, "choices.0.message.content").String())
	assert.Equal(t, 10, response.Usage.TotalTokens)
}

func TestAzureCompatibility_StreamHTTPErrorBeforeIteration(t *testing.T) {
	const body = `{"error":{"code":"rate_limit","message":"slow down"}}`
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Retry-After", "12")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, body)
	}))
	defer backend.Close()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10})
	require.NoError(t, err)
	defer router.Close()
	iter, err := router.DispatchStream(context.Background(), &domain.Request{Type: domain.RequestTypeChat, Model: "gpt-test", Body: []byte(`{"model":"gpt-test","messages":[],"stream":true}`)}, domain.Credential{ID: "azure", ProviderID: domain.ProviderAzure, APIKey: "key", Extra: map[string]string{"endpoint": backend.URL}, DeploymentMap: map[string]string{"gpt-test": "deployment"}})
	require.Nil(t, iter)
	var upstream *domain.UpstreamError
	require.ErrorAs(t, err, &upstream)
	assert.Equal(t, http.StatusTooManyRequests, upstream.StatusCode)
	assert.JSONEq(t, body, string(upstream.Body))
	assert.Equal(t, "12", upstream.Headers["Retry-After"])
}

// @scenario "Azure passthrough keeps the credential API version"
func TestAzureCompatibility_PassthroughConfiguredVersion(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/openai/deployments/deployment/images/generations", r.URL.Path)
		assert.Equal(t, "2025-04-01-preview", r.URL.Query().Get("api-version"))
		assert.Equal(t, "kept", r.URL.Query().Get("extra"))
		_, _ = io.WriteString(w, `{"data":[]}`)
	}))
	defer backend.Close()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10})
	require.NoError(t, err)
	defer router.Close()
	response, err := router.Dispatch(context.Background(), &domain.Request{Type: domain.RequestTypePassthrough, Model: "image-model", Body: []byte(`{"prompt":"hello"}`), Passthrough: domain.PassthroughRequest{Method: http.MethodPost, Path: "/openai/deployments/deployment/images/generations", RawQuery: "api-version=client-version&extra=kept"}}, domain.Credential{ID: "azure", ProviderID: domain.ProviderAzure, APIKey: "key", Extra: map[string]string{"endpoint": backend.URL, "api_version": "2025-04-01-preview"}})
	require.NoError(t, err)
	assert.JSONEq(t, `{"data":[]}`, string(response.Body))
}

func TestAzureCompatibility_ZeroStatusNormalizesSuccess(t *testing.T) {
	for _, status := range []int{0, http.StatusOK} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			resp, err := azureCompatibilityResponse(&bfschemas.BifrostPassthroughResponse{StatusCode: status, Body: []byte(`{"data":[{"index":0,"embedding":[0.5]}],"usage":{"prompt_tokens":7,"total_tokens":7}}`)}, &domain.Request{Type: domain.RequestTypeEmbeddings}, "public-model")
			require.NoError(t, err)
			assert.Equal(t, http.StatusOK, resp.StatusCode)
			assert.Equal(t, 7, resp.Usage.PromptTokens)
			assert.Equal(t, "public-model", gjson.GetBytes(resp.Body, "model").String())
			assert.InDelta(t, 0.5, gjson.GetBytes(resp.Body, "data.0.embedding.0").Float(), 0.0001)
		})
	}
}

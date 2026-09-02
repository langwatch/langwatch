package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bytedance/sonic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// openAIResponsesImageGenerationBody is the shape api.openai.com returns from
// /v1/responses when the model calls the image_generation tool. The
// image_generation_call item carries "action":"generate" as a plain string,
// which Bifrost's tool-message schema reads as an object with a type field,
// so the engine reports ErrProviderResponseUnmarshal on a complete 200 body.
// One item is still in progress with a null result, one is completed with a
// short base64 result, and the tools array echoes the caller's tool.
const openAIResponsesImageGenerationBody = `{"id":"resp_1","object":"response","created_at":1788352872,` +
	`"status":"completed","model":"gpt-4.1-mini-2025-04-14","output":[` +
	`{"id":"ig_0","type":"image_generation_call","status":"in_progress","action":"generate","result":null},` +
	`{"id":"ig_1","type":"image_generation_call","status":"completed","action":"generate",` +
	`"background":"opaque","output_format":"png","quality":"low","result":"iVBORw0KGgo=",` +
	`"revised_prompt":"a tiny red square","size":"1024x1024"},` +
	`{"id":"msg_1","type":"message","status":"completed","content":[{"type":"output_text",` +
	`"annotations":[],"logprobs":[],"text":"Here is the image."}],"role":"assistant"}],` +
	`"tools":[{"type":"image_generation","background":"auto","model":"gpt-image-2","moderation":"auto",` +
	`"n":1,"output_compression":100,"output_format":"png","quality":"low","size":"1024x1024"}],` +
	`"usage":{"input_tokens":1960,"input_tokens_details":{"cache_write_tokens":0,"cached_tokens":12},` +
	`"output_tokens":37,"output_tokens_details":{"reasoning_tokens":5},"total_tokens":1997}}`

// The fixture must be a body the pinned engine cannot decode. If a later
// engine release reads it, the regression below stops exercising the
// parse-failure lane and this test says so.
func TestOpenAIResponsesImageGenerationBody_FailsEngineDecode(t *testing.T) {
	var resp bfschemas.BifrostResponsesResponse
	err := sonic.Unmarshal([]byte(openAIResponsesImageGenerationBody), &resp)
	require.Error(t, err, "the fixture must trip the engine schema; pick another shape if it parses")
	assert.Contains(t, err.Error(), "failed to peek at type field")
}

func unmarshalFailure(raw string) *bfschemas.BifrostError {
	return &bfschemas.BifrostError{
		IsBifrostError: true,
		Error: &bfschemas.ErrorField{
			Message: bfschemas.ErrProviderResponseUnmarshal,
			Error:   errors.New("failed to peek at type field: mismatched type"),
		},
		ExtraFields: bfschemas.BifrostErrorExtraFields{
			Provider:    bfschemas.OpenAI,
			RawResponse: json.RawMessage(raw),
		},
	}
}

func providerAnswer(status int, raw string) *bfschemas.BifrostError {
	return &bfschemas.BifrostError{
		StatusCode: &status,
		Error:      &bfschemas.ErrorField{Message: "provider said no"},
		ExtraFields: bfschemas.BifrostErrorExtraFields{
			Provider:    bfschemas.OpenAI,
			RawResponse: json.RawMessage(raw),
		},
	}
}

// Spec: specs/ai-gateway/error-transparency.feature
// @scenario "A provider 200 the engine cannot decode is forwarded as a 200 with its usage"
func TestRawResponseFromBifrostError_StatusAndUsage(t *testing.T) {
	cases := []struct {
		name       string
		berr       *bfschemas.BifrostError
		wantOK     bool
		wantStatus int
		wantUsage  domain.Usage
		wantParse  bool
	}{
		{
			name:       "provider 4xx keeps its status and reports no usage",
			berr:       providerAnswer(http.StatusTooManyRequests, `{"error":{"message":"slow down"}}`),
			wantOK:     true,
			wantStatus: http.StatusTooManyRequests,
		},
		{
			name:       "provider 5xx keeps its status and reports no usage",
			berr:       providerAnswer(http.StatusServiceUnavailable, `{"error":{"message":"overloaded"}}`),
			wantOK:     true,
			wantStatus: http.StatusServiceUnavailable,
		},
		{
			name:       "engine parse failure of a 200 forwards 200 and recovers usage",
			berr:       unmarshalFailure(openAIResponsesImageGenerationBody),
			wantOK:     true,
			wantStatus: http.StatusOK,
			wantParse:  true,
			wantUsage: domain.Usage{
				PromptTokens:     1960,
				CompletionTokens: 37,
				TotalTokens:      1997,
				CacheReadTokens:  12,
				ReasoningTokens:  5,
			},
		},
		{
			name: "engine failure of another class with no status stays a 502",
			berr: &bfschemas.BifrostError{
				Error: &bfschemas.ErrorField{Message: bfschemas.ErrProviderResponseHTML},
				ExtraFields: bfschemas.BifrostErrorExtraFields{
					RawResponse: json.RawMessage(`<html>maintenance</html>`),
				},
			},
			wantOK:     true,
			wantStatus: http.StatusBadGateway,
		},
		{
			name: "parse failure without a body has nothing to forward",
			berr: &bfschemas.BifrostError{
				Error: &bfschemas.ErrorField{Message: bfschemas.ErrProviderResponseUnmarshal},
			},
			wantOK: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw, ok := rawResponseFromBifrostError(tc.berr)
			require.Equal(t, tc.wantOK, ok)
			if !ok {
				return
			}
			assert.Equal(t, tc.wantStatus, raw.status)
			assert.Equal(t, tc.wantUsage, raw.usage)
			assert.Equal(t, tc.wantParse, raw.parseFailure != nil)
			assert.Equal(t, []byte(tc.berr.ExtraFields.RawResponse.(json.RawMessage)), raw.body)
		})
	}
}

func TestUsageFromRawJSON_CoversTheThreeOpenAIShapes(t *testing.T) {
	cases := []struct {
		name string
		body string
		want domain.Usage
	}{
		{
			name: "responses shape",
			body: `{"usage":{"input_tokens":100,"input_tokens_details":{"cached_tokens":40},` +
				`"output_tokens":50,"output_tokens_details":{"reasoning_tokens":20},"total_tokens":150}}`,
			want: domain.Usage{PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150,
				CacheReadTokens: 40, ReasoningTokens: 20},
		},
		{
			name: "chat completions shape",
			body: `{"usage":{"prompt_tokens":30,"prompt_tokens_details":{"cached_tokens":10},` +
				`"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":3},"total_tokens":37}}`,
			want: domain.Usage{PromptTokens: 30, CompletionTokens: 7, TotalTokens: 37,
				CacheReadTokens: 10, ReasoningTokens: 3},
		},
		{
			name: "images shape splits image tokens out of the totals",
			body: `{"usage":{"input_tokens":14,"input_tokens_details":{"image_tokens":0,"text_tokens":14},` +
				`"output_tokens":196,"output_tokens_details":{"image_tokens":196,"text_tokens":0},"total_tokens":210}}`,
			want: domain.Usage{PromptTokens: 14, CompletionTokens: 0, TotalTokens: 210, OutputImageTokens: 196},
		},
		{
			name: "no usage block reports nothing",
			body: `{"id":"resp_1"}`,
			want: domain.Usage{},
		},
		{
			name: "missing total is the sum of the two sides",
			body: `{"usage":{"input_tokens":3,"output_tokens":4}}`,
			want: domain.Usage{PromptTokens: 3, CompletionTokens: 4, TotalTokens: 7},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, usageFromRawJSON([]byte(tc.body)))
		})
	}
}

// Runs the real dispatch path against a fake OpenAI that answers /v1/responses
// with an image_generation_call body. The engine cannot decode that body, and
// the gateway must still hand the client the provider's 200 with the exact
// bytes, and meter the request.
//
// Spec: specs/ai-gateway/error-transparency.feature
// @scenario "A provider 200 the engine cannot decode is forwarded as a 200 with its usage"
func TestDispatchResponses_ImageGenerationCall_Forwards200WithUsage(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// assert, not require: FailNow inside an http handler goroutine is
		// undefined behavior (testifylint go-require).
		assert.Equal(t, "/v1/responses", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(openAIResponsesImageGenerationBody))
	}))
	defer backend.Close()

	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger:           zap.NewNop(),
		OpenAIBackendURL: backend.URL,
	})
	require.NoError(t, err)
	defer router.Close()

	resp, err := router.Dispatch(context.Background(), &domain.Request{
		Type:  domain.RequestTypeResponses,
		Model: "openai/gpt-4.1-mini",
		Body: []byte(`{"model":"gpt-4.1-mini","input":"draw a tiny red square",` +
			`"tools":[{"type":"image_generation","size":"1024x1024","quality":"low"}]}`),
	}, openAICredential())
	require.NoError(t, err, "a provider 200 the engine cannot decode is still a provider answer")

	assert.Equal(t, http.StatusOK, resp.StatusCode, "the provider answered 200; a schema gap in the engine is not a 502")
	assert.True(t, bytes.Equal([]byte(openAIResponsesImageGenerationBody), resp.Body),
		"the provider's bytes go out unchanged, byte for byte")
	assert.Equal(t, 1960, resp.Usage.PromptTokens)
	assert.Equal(t, 37, resp.Usage.CompletionTokens)
	assert.Equal(t, 1997, resp.Usage.TotalTokens)
	assert.Equal(t, 12, resp.Usage.CacheReadTokens)
	assert.Equal(t, 5, resp.Usage.ReasoningTokens)
}

package providers

// Binds specs/ai-gateway/images-endpoints.feature: the usage split the image
// endpoints meter with, the credential shapes they refuse, and the wire the
// gateway actually puts on OpenAI for both routes.

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestExtractImageUsage_SplitsTheTokenDetails(t *testing.T) {
	resp := &bfschemas.BifrostImageGenerationResponse{
		Model: "gpt-image-2",
		Data:  []bfschemas.ImageData{{B64JSON: "AAAA"}},
		Usage: &bfschemas.ImageUsage{
			InputTokens:         14,
			InputTokensDetails:  &bfschemas.ImageTokenDetails{TextTokens: 14},
			OutputTokens:        196,
			OutputTokensDetails: &bfschemas.ImageTokenDetails{ImageTokens: 196},
			TotalTokens:         210,
		},
	}

	usage := extractImageUsage(resp)

	assert.Equal(t, 14, usage.PromptTokens)
	assert.Equal(t, 0, usage.InputImageTokens)
	assert.Equal(t, 196, usage.OutputImageTokens)
	assert.Equal(t, 210, usage.TotalTokens)
	assert.Equal(t, 1, usage.ImageCount)
	assert.Equal(t, "gpt-image-2", usage.Model)
	// Disjoint: the image tokens are out of the completion total, so nothing
	// downstream prices them twice.
	assert.Equal(t, 0, usage.CompletionTokens)
}

func TestExtractImageUsage_EditCountsTheInputImageTokens(t *testing.T) {
	resp := &bfschemas.BifrostImageGenerationResponse{
		Data: []bfschemas.ImageData{{B64JSON: "AAAA"}, {B64JSON: "BBBB"}},
		Usage: &bfschemas.ImageUsage{
			InputTokens:         340,
			InputTokensDetails:  &bfschemas.ImageTokenDetails{ImageTokens: 320, TextTokens: 20},
			OutputTokens:        1568,
			OutputTokensDetails: &bfschemas.ImageTokenDetails{ImageTokens: 1568},
			TotalTokens:         1908,
		},
	}

	usage := extractImageUsage(resp)

	assert.Equal(t, 320, usage.InputImageTokens)
	assert.Equal(t, 20, usage.PromptTokens)
	assert.Equal(t, 1568, usage.OutputImageTokens)
	assert.Equal(t, 0, usage.CompletionTokens)
	assert.Equal(t, 2, usage.ImageCount)
}

// A provider that states no breakdown still bills its output as image tokens,
// which is what every model on these routes answers in.
func TestExtractImageUsage_WithoutDetailsTreatsOutputAsImageTokens(t *testing.T) {
	resp := &bfschemas.BifrostImageGenerationResponse{
		Data:  []bfschemas.ImageData{{B64JSON: "AAAA"}},
		Usage: &bfschemas.ImageUsage{InputTokens: 11, OutputTokens: 400, TotalTokens: 411},
	}

	usage := extractImageUsage(resp)

	assert.Equal(t, 11, usage.PromptTokens)
	assert.Equal(t, 0, usage.InputImageTokens)
	assert.Equal(t, 400, usage.OutputImageTokens)
	assert.Equal(t, 0, usage.CompletionTokens)
}

func TestExtractImageUsage_NoUsageStillCountsTheImages(t *testing.T) {
	resp := &bfschemas.BifrostImageGenerationResponse{
		Data: []bfschemas.ImageData{{B64JSON: "AAAA"}},
	}

	usage := extractImageUsage(resp)

	assert.Equal(t, 1, usage.ImageCount)
	assert.Equal(t, 0, usage.TotalTokens)
	assert.Equal(t, domain.Usage{ImageCount: 1}, usage)
}

// @scenario "An OpenAI credential with a custom base URL is refused with a readable message"
func TestImageEndpointSupported_RefusesTheOpenAICompatibleProvider(t *testing.T) {
	err := imageEndpointSupported(context.Background(), bfschemas.VLLM)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "custom base URL")

	assert.NoError(t, imageEndpointSupported(context.Background(), bfschemas.OpenAI))
	assert.NoError(t, imageEndpointSupported(context.Background(), bfschemas.Azure))
}

func TestImageGenerationWireRequest_MapsOnlyWhatTheCallerSent(t *testing.T) {
	var wire imageGenerationWireRequest
	require.NoError(t, json.Unmarshal(
		[]byte(`{"model":"gpt-image-2","prompt":"a bicycle","size":"1024x1024","n":2}`), &wire))

	params := wire.imageParams()

	require.NotNil(t, params.Size)
	assert.Equal(t, "1024x1024", *params.Size)
	require.NotNil(t, params.N)
	assert.Equal(t, 2, *params.N)
	// gpt-image rejects response_format outright, so it must reach the
	// provider only when the caller asked for it.
	assert.Nil(t, params.ResponseFormat)
	assert.Nil(t, params.Quality)
	assert.Nil(t, params.Style)
	assert.Nil(t, params.User)

	require.NoError(t, json.Unmarshal(
		[]byte(`{"model":"dall-e-3","prompt":"a bicycle","response_format":"b64_json"}`), &wire))
	params = wire.imageParams()
	require.NotNil(t, params.ResponseFormat)
	assert.Equal(t, "b64_json", *params.ResponseFormat)
}

func TestImageEditParams_MapsTheAllowlistedFormFields(t *testing.T) {
	params := imageEditParams(&domain.ImageEditUpload{
		Mask: []byte("mask-bytes"),
		Params: map[string]string{
			"size": "1024x1024", "quality": "low", "n": "2",
			"output_compression": "80", "input_fidelity": "high",
		},
	})

	assert.Equal(t, []byte("mask-bytes"), params.Mask)
	require.NotNil(t, params.Size)
	assert.Equal(t, "1024x1024", *params.Size)
	require.NotNil(t, params.N)
	assert.Equal(t, 2, *params.N)
	require.NotNil(t, params.OutputCompression)
	assert.Equal(t, 80, *params.OutputCompression)
	require.NotNil(t, params.InputFidelity)
	assert.Equal(t, "high", *params.InputFidelity)
	assert.Nil(t, params.ResponseFormat)
	assert.Nil(t, params.Background)
	assert.Nil(t, params.User)
}

// --- end to end against a fake OpenAI ---

const fakeOpenAIImageResponse = `{"created":1,"data":[{"b64_json":"AAAA"}],` +
	`"usage":{"input_tokens":14,"input_tokens_details":{"image_tokens":0,"text_tokens":14},` +
	`"output_tokens":196,"output_tokens_details":{"image_tokens":196,"text_tokens":0},` +
	`"total_tokens":210}}`

func openAICredential() domain.Credential {
	return domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-test"}
}

// @scenario "OpenAI-shape image generation returns the images JSON"
func TestDispatchImageGeneration_PostsTheOpenAIJSONAndMetersTheAnswer(t *testing.T) {
	var got map[string]any
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// assert, not require: FailNow inside an http handler goroutine is
		// undefined behavior (testifylint go-require).
		assert.Equal(t, "/v1/images/generations", r.URL.Path)
		body, err := io.ReadAll(r.Body)
		assert.NoError(t, err)
		assert.NoError(t, json.Unmarshal(body, &got))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fakeOpenAIImageResponse))
	}))
	defer backend.Close()

	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger:           zap.NewNop(),
		OpenAIBackendURL: backend.URL,
	})
	require.NoError(t, err)
	defer router.Close()

	resp, err := router.Dispatch(context.Background(), &domain.Request{
		Type:  domain.RequestTypeImageGeneration,
		Model: "gpt-image-2",
		Body: []byte(`{"model":"gpt-image-2","prompt":"a red bicycle",` +
			`"size":"1024x1024","quality":"low","n":1}`),
	}, openAICredential())
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	assert.Equal(t, "gpt-image-2", got["model"])
	assert.Equal(t, "a red bicycle", got["prompt"])
	assert.Equal(t, "1024x1024", got["size"])
	assert.Equal(t, "low", got["quality"])
	assert.EqualValues(t, 1, got["n"])
	_, sentResponseFormat := got["response_format"]
	assert.False(t, sentResponseFormat, "response_format must not be invented; gpt-image rejects it")

	var parsed struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(resp.Body, &parsed))
	require.Len(t, parsed.Data, 1)
	assert.Equal(t, "AAAA", parsed.Data[0].B64JSON)

	assert.Equal(t, 196, resp.Usage.OutputImageTokens)
	assert.Equal(t, 14, resp.Usage.PromptTokens)
	assert.Equal(t, 0, resp.Usage.InputImageTokens)
	assert.Equal(t, 1, resp.Usage.ImageCount)
}

// @scenario "The OpenAI SDK's image[] parts carry every source image"
func TestDispatchImageEdit_SendsEverySourceImageAndTheMask(t *testing.T) {
	files := map[string][]string{}
	fields := map[string]string{}
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/images/edits", r.URL.Path)
		_, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		assert.NoError(t, err)
		reader := multipart.NewReader(r.Body, params["boundary"])
		for {
			part, err := reader.NextPart()
			if err != nil {
				break
			}
			content, readErr := io.ReadAll(part)
			assert.NoError(t, readErr)
			if part.FileName() != "" {
				files[part.FormName()] = append(files[part.FormName()], string(content))
			} else {
				fields[part.FormName()] = string(content)
			}
			_ = part.Close()
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fakeOpenAIImageResponse))
	}))
	defer backend.Close()

	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger:           zap.NewNop(),
		OpenAIBackendURL: backend.URL,
	})
	require.NoError(t, err)
	defer router.Close()

	resp, err := router.Dispatch(context.Background(), &domain.Request{
		Type:  domain.RequestTypeImageEdit,
		Model: "gpt-image-2",
		Body:  []byte(`{"model":"gpt-image-2","prompt":"put it on a beach"}`),
		ImageEdit: &domain.ImageEditUpload{
			Images: [][]byte{[]byte("first-png"), []byte("second-png")},
			Mask:   []byte("mask-png"),
			Params: map[string]string{
				"prompt": "put it on a beach", "size": "1024x1024", "quality": "low",
			},
		},
	}, openAICredential())
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	assert.Equal(t, []string{"first-png", "second-png"}, files["image[]"])
	assert.Equal(t, []string{"mask-png"}, files["mask"])
	assert.Equal(t, "put it on a beach", fields["prompt"])
	assert.Equal(t, "1024x1024", fields["size"])
	assert.Equal(t, "low", fields["quality"])
	assert.Equal(t, 196, resp.Usage.OutputImageTokens)
}

// @scenario "A streamed image request is refused before dispatch"
func TestDispatchStream_RefusesTheImageRequestTypes(t *testing.T) {
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop()})
	require.NoError(t, err)
	defer router.Close()

	for _, reqType := range []domain.RequestType{
		domain.RequestTypeImageGeneration, domain.RequestTypeImageEdit,
	} {
		_, err := router.DispatchStream(context.Background(), &domain.Request{
			Type:  reqType,
			Model: "gpt-image-2",
			Body:  []byte(`{"model":"gpt-image-2","prompt":"a red bicycle"}`),
		}, openAICredential())
		require.Error(t, err, "%s must not fall through to the chat stream", reqType)
		assert.Contains(t, err.Error(), "streaming image generation is not supported")
	}
}

package httpapi

// Binds specs/ai-gateway/images-endpoints.feature: the @unit scenarios for
// POST /v1/images/generations and POST /v1/images/edits: routing, multipart
// parsing, the size cap, missing-field errors, allowlist enforcement, and the
// refusal of streamed images. The @integration scenarios run live via the
// tests/matrix images cells.

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const fakeImageResponse = `{"created":1,"data":[{"b64_json":"AAAA"}]}`

// imagesRouter builds an image-capable router over a provider that answers
// both image routes with the OpenAI images JSON.
func imagesRouter(capture *domain.Request) http.Handler {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (*domain.Response, error) {
			if capture != nil {
				*capture = *req
			}
			switch req.Type {
			case domain.RequestTypeImageGeneration, domain.RequestTypeImageEdit:
				return &domain.Response{
					Body:       []byte(fakeImageResponse),
					StatusCode: http.StatusOK,
					Usage:      domain.Usage{PromptTokens: 14, OutputImageTokens: 196, ImageCount: 1},
				}, nil
			default:
				return successResponse(), nil
			}
		},
	}
	return buildRouter(
		app.WithAuth(&mockAuth{resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		}}),
		app.WithProviders(provider),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)
}

type imageFile struct {
	field    string
	filename string
	content  []byte
}

// imageMultipartBody writes a form with any number of file parts, which is
// what separates an image edit from a transcription: the OpenAI SDK posts the
// source images as repeated "image[]" parts.
func imageMultipartBody(t *testing.T, fields map[string]string, files []imageFile) (*bytes.Buffer, string) {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	for k, v := range fields {
		require.NoError(t, w.WriteField(k, v))
	}
	for _, f := range files {
		fw, err := w.CreateFormFile(f.field, f.filename)
		require.NoError(t, err)
		_, err = fw.Write(f.content)
		require.NoError(t, err)
	}
	require.NoError(t, w.Close())
	return buf, w.FormDataContentType()
}

// blockedImageRouter answers nothing and records whether the provider was
// reached, for the scenarios that must fail before dispatch.
func blockedImageRouter(dispatched *bool) http.Handler {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			// A t.Fatal here would Goexit the heartbeat goroutine and wedge
			// the handler; record and assert from the test goroutine instead.
			*dispatched = true
			return successResponse(), nil
		},
	}
	return buildRouter(
		app.WithAuth(&mockAuth{resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		}}),
		app.WithProviders(provider),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)
}

// --- /v1/images/generations ---

// @scenario "OpenAI-shape image generation returns the images JSON"
func TestImageGenerations_ReturnsImagesJSON(t *testing.T) {
	var captured domain.Request
	router := imagesRouter(&captured)

	body := `{"model":"openai/gpt-image-2","prompt":"a red bicycle","size":"1024x1024","quality":"low","n":1}`
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	var parsed struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &parsed))
	require.Len(t, parsed.Data, 1)
	assert.Equal(t, "AAAA", parsed.Data[0].B64JSON, "an OpenAI SDK reads data[0].b64_json")

	assert.Equal(t, domain.RequestTypeImageGeneration, captured.Type)
	require.NotNil(t, captured.Resolved)
	assert.Equal(t, "gpt-image-2", captured.Resolved.ModelID)
	assert.Equal(t, domain.ProviderOpenAI, captured.Resolved.ProviderID)
	assert.Contains(t, string(captured.Body), "a red bicycle")

	assert.NotEmpty(t, rec.Header().Get("X-LangWatch-Gateway-Request-Id"),
		"image responses carry the same gateway meta headers as chat")
}

// @scenario "A streamed image request is refused before dispatch"
func TestImageGenerations_StreamIsRejectedBeforeDispatch(t *testing.T) {
	dispatched := false
	router := blockedImageRouter(&dispatched)

	body := `{"model":"openai/gpt-image-2","prompt":"a red bicycle","stream":true}`
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "streaming image generation is not supported")
	assert.False(t, dispatched, "a streamed image request must not reach the provider")
}

// @scenario "A streamed image request is refused before dispatch"
func TestImageGenerations_PartialImagesIsRejectedBeforeDispatch(t *testing.T) {
	dispatched := false
	router := blockedImageRouter(&dispatched)

	body := `{"model":"openai/gpt-image-2","prompt":"a red bicycle","partial_images":2}`
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "partial_images")
	assert.False(t, dispatched, "a partial-image request must not reach the provider")
}

// --- /v1/images/edits ---

// @scenario "The OpenAI SDK's image[] parts carry every source image"
func TestImageEdits_PluralImageFieldCarriesEveryFile(t *testing.T) {
	var captured domain.Request
	router := imagesRouter(&captured)

	buf, contentType := imageMultipartBody(t,
		map[string]string{
			"model":      "openai/gpt-image-2",
			"prompt":     "put the bicycle on a beach",
			"size":       "1024x1024",
			"quality":    "low",
			"n":          "1",
			"evil_field": "1; DROP TABLE",
		},
		[]imageFile{
			{field: "image[]", filename: "one.png", content: []byte("first-png-bytes")},
			{field: "image[]", filename: "two.png", content: []byte("second-png-bytes")},
			{field: "mask", filename: "mask.png", content: []byte("mask-bytes")},
		})
	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", buf)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, domain.RequestTypeImageEdit, captured.Type)
	require.NotNil(t, captured.ImageEdit)
	require.Len(t, captured.ImageEdit.Images, 2)
	assert.Equal(t, []byte("first-png-bytes"), captured.ImageEdit.Images[0])
	assert.Equal(t, []byte("second-png-bytes"), captured.ImageEdit.Images[1])
	assert.Equal(t, []byte("mask-bytes"), captured.ImageEdit.Mask)
	assert.Equal(t, "1024x1024", captured.ImageEdit.Params["size"])
	assert.Equal(t, "low", captured.ImageEdit.Params["quality"])
	assert.Equal(t, "1", captured.ImageEdit.Params["n"])
	_, present := captured.ImageEdit.Params["evil_field"]
	assert.False(t, present, "unknown form fields must not be forwarded")

	require.NotNil(t, captured.Resolved)
	assert.Equal(t, "gpt-image-2", captured.Resolved.ModelID)

	// The synthesized body is what guardrails, policy and end-user
	// resolution read, so the prompt has to be in it.
	assert.Contains(t, string(captured.Body), "put the bicycle on a beach")
}

// @scenario "A single image posted under the singular field is accepted"
func TestImageEdits_SingularImageFieldWithoutMask(t *testing.T) {
	var captured domain.Request
	router := imagesRouter(&captured)

	buf, contentType := imageMultipartBody(t,
		map[string]string{"model": "openai/gpt-image-2", "prompt": "make it blue"},
		[]imageFile{{field: "image", filename: "one.png", content: []byte("only-png-bytes")}})
	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", buf)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, captured.ImageEdit)
	require.Len(t, captured.ImageEdit.Images, 1)
	assert.Equal(t, []byte("only-png-bytes"), captured.ImageEdit.Images[0])
	assert.Nil(t, captured.ImageEdit.Mask)
}

// @scenario "A form using both image field names is refused"
func TestImageEdits_BothImageFieldNamesIs400BeforeDispatch(t *testing.T) {
	dispatched := false
	router := blockedImageRouter(&dispatched)

	buf, contentType := imageMultipartBody(t,
		map[string]string{"model": "openai/gpt-image-2", "prompt": "make it blue"},
		[]imageFile{
			{field: "image", filename: "one.png", content: []byte("singular-png")},
			{field: "image[]", filename: "two.png", content: []byte("plural-png")},
		})
	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", buf)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "image[]")
	assert.False(t, dispatched, "an ambiguous source order must not reach the provider")
}

// @scenario "A multipart edit with no image part fails informatively"
func TestImageEdits_MissingImageIs400BeforeDispatch(t *testing.T) {
	dispatched := false
	router := blockedImageRouter(&dispatched)

	buf, contentType := imageMultipartBody(t,
		map[string]string{"model": "openai/gpt-image-2", "prompt": "make it blue"}, nil)
	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", buf)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "image")
	assert.False(t, dispatched, "provider must not be contacted without an image")
}

// @scenario "A multipart edit with no prompt fails informatively"
func TestImageEdits_MissingPromptIs400BeforeDispatch(t *testing.T) {
	dispatched := false
	router := blockedImageRouter(&dispatched)

	buf, contentType := imageMultipartBody(t,
		map[string]string{"model": "openai/gpt-image-2"},
		[]imageFile{{field: "image[]", filename: "one.png", content: []byte("png")}})
	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", buf)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "prompt")
	assert.False(t, dispatched, "provider must not be contacted without a prompt")
}

// @scenario "A streamed image request is refused before dispatch"
func TestImageEdits_StreamFormValueIsRejectedBeforeDispatch(t *testing.T) {
	dispatched := false
	router := blockedImageRouter(&dispatched)

	buf, contentType := imageMultipartBody(t,
		map[string]string{"model": "openai/gpt-image-2", "prompt": "make it blue", "stream": "true"},
		[]imageFile{{field: "image[]", filename: "one.png", content: []byte("png")}})
	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", buf)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "streaming image generation is not supported")
	assert.False(t, dispatched, "a streamed image request must not reach the provider")
}

// @scenario "Oversized image uploads are rejected before provider dispatch"
func TestImageEdits_OversizedUploadIs413BeforeDispatch(t *testing.T) {
	dispatched := false
	router := blockedImageRouter(&dispatched)

	// One byte past the cap. The handler must reject while parsing, without
	// buffering the whole body into a provider request.
	big := bytes.Repeat([]byte("a"), maxImageEditBodyBytes+1)
	buf, contentType := imageMultipartBody(t,
		map[string]string{"model": "openai/gpt-image-2", "prompt": "make it blue"},
		[]imageFile{{field: "image[]", filename: "big.png", content: big}})
	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", buf)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.False(t, dispatched, "provider must not be contacted for an oversized upload")
}

// @scenario "Image requests authenticate exactly like chat"
func TestImageGenerations_RequiresAuthLikeChat(t *testing.T) {
	router := imagesRouter(nil)

	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations",
		strings.NewReader(`{"model":"gpt-image-2","prompt":"hi"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

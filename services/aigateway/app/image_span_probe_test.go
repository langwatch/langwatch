package app

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// imageProvider answers both image routes with the OpenAI images JSON and the
// usage an image call meters.
func imageProvider() *mockProvider {
	return &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (*domain.Response, error) {
			switch req.Type {
			case domain.RequestTypeImageGeneration, domain.RequestTypeImageEdit:
				return &domain.Response{
					Body:       []byte(`{"created":1,"data":[{"b64_json":"AAAA"}]}`),
					StatusCode: 200,
					Usage:      domain.Usage{PromptTokens: 14, OutputImageTokens: 196, ImageCount: 1},
				}, nil
			default:
				return &domain.Response{Body: []byte(`{}`), StatusCode: 200}, nil
			}
		},
	}
}

func TestImageGenerationDispatchEmitsCustomerSpan(t *testing.T) {
	rec := &recordingEmitter{}
	application := New(
		WithProviders(imageProvider()),
		WithModels(modelresolver.New()),
		WithTraces(rec),
		WithLogger(zap.NewNop()),
	)

	body := `{"model":"openai/gpt-image-2","prompt":"a red bicycle","size":"1024x1024"}`
	_, err := application.HandleImageGeneration(context.Background(), testBundle(),
		strings.NewReader(body), "openai/gpt-image-2")
	require.NoError(t, err)

	assert.Equal(t, []domain.RequestType{domain.RequestTypeImageGeneration}, rec.began,
		"BeginSpan must fire for image generation")
	require.Len(t, rec.ended, 1, "EndSpan must fire for image generation")
	assert.Equal(t, domain.RequestTypeImageGeneration, rec.ended[0].RequestType)
	assert.Equal(t, 196, rec.ended[0].Usage.OutputImageTokens)
}

func TestImageEditDispatchEmitsCustomerSpanWithThePrompt(t *testing.T) {
	rec := &recordingEmitter{}
	application := New(
		WithProviders(imageProvider()),
		WithModels(modelresolver.New()),
		WithTraces(rec),
		WithLogger(zap.NewNop()),
	)

	upload := &domain.ImageEditUpload{
		Images: [][]byte{[]byte("png-bytes")},
		Params: map[string]string{"prompt": "put it on a beach", "user": "customer-42"},
	}
	_, err := application.HandleImageEdit(context.Background(), testBundle(), upload, "openai/gpt-image-2")
	require.NoError(t, err)

	assert.Equal(t, []domain.RequestType{domain.RequestTypeImageEdit}, rec.began,
		"BeginSpan must fire for image edit")
	require.Len(t, rec.ended, 1, "EndSpan must fire for image edit")
	assert.Equal(t, domain.RequestTypeImageEdit, rec.ended[0].RequestType)
	// The synthesized body is the only thing the pipeline can read a prompt
	// and an end user off: the images ride beside it as raw bytes.
	assert.Contains(t, string(rec.ended[0].RequestBody), "put it on a beach")
	assert.Contains(t, string(rec.ended[0].RequestBody), "customer-42")
}

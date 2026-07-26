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

type recordingEmitter struct {
	began []domain.RequestType
	ended []domain.AITraceParams
}

func (r *recordingEmitter) BeginSpan(ctx context.Context, projectID string, reqType domain.RequestType) (context.Context, string) {
	r.began = append(r.began, reqType)
	return ctx, "00-traceparent-stub-01"
}

func (r *recordingEmitter) EndSpan(_ context.Context, params domain.AITraceParams) {
	r.ended = append(r.ended, params)
}

func TestSpeechDispatchEmitsCustomerSpan(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (*domain.Response, error) {
			if req.Type == domain.RequestTypeSpeech {
				return &domain.Response{Body: []byte("binary-audio"), StatusCode: 200, Headers: map[string]string{"Content-Type": "audio/pcm"}, Usage: domain.Usage{InputChars: 12}}, nil
			}
			return &domain.Response{Body: []byte(`{"text":"hi"}`), StatusCode: 200}, nil
		},
	}
	rec := &recordingEmitter{}
	application := New(
		WithProviders(provider),
		WithModels(modelresolver.New()),
		WithTraces(rec),
		WithLogger(zap.NewNop()),
	)

	body := `{"model":"openai/gpt-4o-mini-tts","voice":"nova","input":"hello"}`
	_, err := application.HandleSpeech(context.Background(), testBundle(), strings.NewReader(body), "openai/gpt-4o-mini-tts")
	require.NoError(t, err)

	assert.Equal(t, []domain.RequestType{domain.RequestTypeSpeech}, rec.began, "BeginSpan must fire for speech")
	require.Len(t, rec.ended, 1, "EndSpan must fire for speech")
	assert.Equal(t, domain.RequestTypeSpeech, rec.ended[0].RequestType)
}

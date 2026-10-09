package app

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type recordingEmitter struct {
	mu    sync.Mutex
	began []domain.RequestType
	ended []domain.AITraceParams
}

func (r *recordingEmitter) closed() []domain.AITraceParams {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]domain.AITraceParams(nil), r.ended...)
}

func (r *recordingEmitter) BeginSpan(ctx context.Context, projectID string, reqType domain.RequestType) (context.Context, string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.began = append(r.began, reqType)
	return ctx, "00-traceparent-stub-01"
}

func (r *recordingEmitter) EndSpan(_ context.Context, params domain.AITraceParams) {
	r.mu.Lock()
	defer r.mu.Unlock()
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
	provider.streamFn = func(ctx context.Context, req *domain.Request, cred domain.Credential) (domain.StreamIterator, error) {
		resp, err := provider.dispatchFn(ctx, req, cred)
		if err != nil {
			return nil, err
		}
		return domain.BufferedStream(resp), nil
	}
	rec := &recordingEmitter{}
	application := New(
		WithProviders(provider),
		WithModels(modelresolver.New()),
		WithTraces(rec),
		WithLogger(zap.NewNop()),
	)

	body := `{"model":"openai/gpt-4o-mini-tts","voice":"nova","input":"hello"}`
	result, err := application.HandleSpeechStream(context.Background(), testBundle(), []byte(body), "openai/gpt-4o-mini-tts")
	require.NoError(t, err)
	for result.Iterator.Next(context.Background()) {
	}
	require.NoError(t, result.Iterator.Close())

	assert.Equal(t, []domain.RequestType{domain.RequestTypeSpeech}, rec.began, "BeginSpan must fire for speech")
	// A stream closes its span off the request path.
	require.Eventually(t, func() bool { return len(rec.closed()) == 1 }, 2*time.Second, 5*time.Millisecond,
		"EndSpan must fire for speech")
	assert.Equal(t, domain.RequestTypeSpeech, rec.closed()[0].RequestType)
}

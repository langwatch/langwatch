package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/services/aigateway/adapters/customertracebridge"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// stubAuth is a no-op auth resolver that returns a minimal bundle.
type stubAuth struct{ bundle *domain.Bundle }

func (s *stubAuth) Resolve(_ context.Context, _ string) (*domain.Bundle, error) {
	return s.bundle, nil
}

// stubProviders returns a canned response.
type stubProviders struct{}

func (s *stubProviders) Dispatch(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
	return &domain.Response{
		StatusCode: 200,
		Body:       []byte(`{"id":"chatcmpl-1","choices":[{"message":{"content":"pong"}}],"usage":{"prompt_tokens":4,"completion_tokens":1}}`),
	}, nil
}
func (s *stubProviders) DispatchStream(_ context.Context, _ *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
	return nil, nil
}
func (s *stubProviders) ListModels(_ context.Context, _ []domain.Credential) ([]domain.Model, error) {
	return nil, nil
}

// BenchmarkRouter_ChatCompletions measures the full HTTP round-trip through
// the chi router with stubbed auth + providers (no real network).
// This captures the overhead of chi routing, middleware stack, body read,
// JSON peek, pipeline dispatch, and response write.
func BenchmarkRouter_ChatCompletions(b *testing.B) {
	bundle := &domain.Bundle{
		VirtualKeyID: "vk_bench",
		ProjectID:    "proj_bench",
		TeamID:       "team_bench",
		Credentials: []domain.Credential{
			{ID: "cred_1", ProviderID: "openai", APIKey: "sk-test"},
		},
		Config: domain.BundleConfig{},
	}

	application := app.New(
		app.WithAuth(&stubAuth{bundle: bundle}),
		app.WithProviders(&stubProviders{}),
		app.WithLogger(zap.NewNop()),
	)

	router := NewRouter(RouterDeps{
		App:           application,
		Logger:        zap.NewNop(),
		Version:       "bench",
		TraceRegistry: customertracebridge.NewRegistry(),
	})

	// Suppress telemetry middleware log output by setting a nop logger on the request context.
	ctx := clog.Set(context.Background(), zap.NewNop())

	body := `{"model":"gpt-5-mini","messages":[{"role":"user","content":"ping"}]}`
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body)).WithContext(ctx)
		req.Header.Set("Authorization", "Bearer lw_vk_live_01HZX0123456789ABCDEFGHIJ")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
	}
}

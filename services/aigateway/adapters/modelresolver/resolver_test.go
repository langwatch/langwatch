package modelresolver

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestResolve_Alias(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{
		ModelAliases: map[string]domain.ModelAlias{
			"my-model": {ProviderID: domain.ProviderAnthropic, Model: "claude-3-opus"},
		},
	}

	got, err := r.Resolve(context.Background(), chatRequest("my-model"), cfg)
	require.NoError(t, err)
	assert.Equal(t, "claude-3-opus", got.ModelID)
	assert.Equal(t, domain.ProviderAnthropic, got.ProviderID)
	assert.Equal(t, domain.ModelSourceAlias, got.Source)
}

func TestResolve_ExplicitFormat(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{}

	got, err := r.Resolve(context.Background(), chatRequest("openai/gpt-4"), cfg)
	require.NoError(t, err)
	assert.Equal(t, "gpt-4", got.ModelID)
	assert.Equal(t, domain.ProviderOpenAI, got.ProviderID)
	assert.Equal(t, domain.ModelSourceExplicit, got.Source)
}

func TestResolve_ExplicitFormat_NormalizedProviders(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		wantProv  domain.ProviderID
		wantModel string
	}{
		{"azure_openai", "azure_openai/m", domain.ProviderAzure, "m"},
		{"google_vertex", "google_vertex/m", domain.ProviderVertex, "m"},
		{"aws_bedrock", "aws_bedrock/m", domain.ProviderBedrock, "m"},
		{"google_gemini", "google_gemini/m", domain.ProviderGemini, "m"},
	}

	r := New()
	cfg := domain.BundleConfig{}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := r.Resolve(context.Background(), chatRequest(tt.raw), cfg)
			require.NoError(t, err)
			assert.Equal(t, tt.wantProv, got.ProviderID)
			assert.Equal(t, tt.wantModel, got.ModelID)
			assert.Equal(t, domain.ModelSourceExplicit, got.Source)
		})
	}
}

func TestResolve_Implicit(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{}

	got, err := r.Resolve(context.Background(), chatRequest("gpt-4"), cfg)
	require.NoError(t, err)
	assert.Equal(t, "gpt-4", got.ModelID)
	assert.Equal(t, domain.ProviderID(""), got.ProviderID)
	assert.Equal(t, domain.ModelSourceImplicit, got.Source)
}

func TestResolve_Allowlist_Allowed(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{
		AllowedModels: []string{"gpt-4", "claude-3"},
	}

	got, err := r.Resolve(context.Background(), chatRequest("gpt-4"), cfg)
	require.NoError(t, err)
	assert.Equal(t, "gpt-4", got.ModelID)
}

func TestResolve_Allowlist_Blocked(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{
		AllowedModels: []string{"claude-3"},
	}

	_, err := r.Resolve(context.Background(), chatRequest("gpt-4"), cfg)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrModelNotAllowed))
}

func TestResolve_Allowlist_GlobSuffix(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{
		AllowedModels: []string{"gpt-*"},
	}

	tests := []struct {
		model string
	}{
		{"gpt-4"},
		{"gpt-4o"},
	}

	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			got, err := r.Resolve(context.Background(), chatRequest(tt.model), cfg)
			require.NoError(t, err)
			assert.Equal(t, tt.model, got.ModelID)
		})
	}
}

func TestResolve_EmptyModel(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{}

	_, err := r.Resolve(context.Background(), chatRequest(""), cfg)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrMissingModel))
}

// @scenario "a request with no model is rejected with a message the client can act on"
func TestResolve_EmptyModelNamesTheCallersOwnSurface(t *testing.T) {
	// ModelResolve is an unconditional interceptor, so every inbound surface
	// reaches this rejection - not just the three that read a top-level JSON
	// field. Naming the JSON endpoints at a caller posting a multipart
	// transcription, or a Gemini caller whose model belongs in the URL, is
	// worse than the vague message this replaced: it sends them to fix a
	// request shape they are not using. Each case therefore asserts both what
	// the message must say and what it must not.
	tests := []struct {
		name        string
		requestType domain.RequestType
		mustSay     []string
		mustNotSay  []string
	}{
		{
			name:        "chat completions",
			requestType: domain.RequestTypeChat,
			mustSay:     []string{`"model"`, "top-level", "JSON request body", "/v1/chat/completions", `{"model": "claude-sonnet-4-5"`},
			mustNotSay:  []string{"/v1/messages", "multipart", "URL path"},
		},
		{
			name:        "the anthropic messages surface",
			requestType: domain.RequestTypeMessages,
			mustSay:     []string{`"model"`, "top-level", "JSON request body", "/v1/messages"},
			mustNotSay:  []string{"/v1/chat/completions", "multipart", "URL path"},
		},
		{
			name:        "the responses surface",
			requestType: domain.RequestTypeResponses,
			mustSay:     []string{`"model"`, "JSON request body", "/v1/responses"},
			mustNotSay:  []string{"multipart", "URL path"},
		},
		{
			name:        "embeddings",
			requestType: domain.RequestTypeEmbeddings,
			mustSay:     []string{`"model"`, "JSON request body", "/v1/embeddings"},
			mustNotSay:  []string{"/v1/chat/completions", "multipart", "URL path"},
		},
		{
			name:        "text to speech",
			requestType: domain.RequestTypeSpeech,
			mustSay:     []string{`"model"`, "JSON request body", "/v1/audio/speech"},
			mustNotSay:  []string{"/v1/chat/completions", "multipart", "URL path"},
		},
		{
			// The model arrives as a form part on a body that carries no JSON
			// at all, so telling this caller about a top-level JSON field
			// sends them looking for something that cannot exist.
			name:        "transcription, whose model is a multipart form part",
			requestType: domain.RequestTypeTranscription,
			mustSay:     []string{`"model"`, "multipart/form-data", "form field", "/v1/audio/transcriptions", `"file"`},
			mustNotSay:  []string{"top-level", "JSON request body", "/v1/chat/completions"},
		},
		{
			// The Gemini passthrough takes the model from the URL, so there is
			// no body field to add on any shape of request.
			name:        "the gemini passthrough, whose model is in the URL",
			requestType: domain.RequestTypePassthrough,
			mustSay:     []string{"URL path", "/v1beta/models/", "generateContent"},
			mustNotSay:  []string{"top-level", "/v1/chat/completions", "multipart"},
		},
		{
			// A surface added later with no entry of its own must stay
			// surface-agnostic rather than inherit somebody else's endpoint.
			name:        "a request type with no entry of its own",
			requestType: domain.RequestType("something-new"),
			mustSay:     []string{"names no model"},
			mustNotSay:  []string{"POST /v1/chat/completions requires"},
		},
	}

	r := New()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := r.Resolve(context.Background(),
				&domain.Request{Type: tt.requestType}, domain.BundleConfig{})
			require.Error(t, err)

			var e herr.E
			require.ErrorAs(t, err, &e)
			assert.Equal(t, domain.ErrMissingModel, e.Code)
			message, _ := e.Meta["message"].(string)

			for _, want := range tt.mustSay {
				assert.Contains(t, message, want)
			}
			for _, unwanted := range tt.mustNotSay {
				assert.NotContains(t, message, unwanted,
					"a %s caller must not be sent to a request shape they are not using", tt.requestType)
			}
			assert.Equal(t, "customer", e.Meta["fault"],
				"a malformed request is the caller's to fix; an unannotated rejection reads as a platform problem")
			assert.Equal(t, string(tt.requestType), e.Meta["request_type"])
		})
	}
}

// @scenario "a request with no model is rejected with a message the client can act on"
func TestResolve_EmptyModelSurvivesANilRequest(t *testing.T) {
	// The port takes a pointer, so a nil is reachable by construction even
	// though the pipeline never passes one. It must reject, not panic.
	_, err := New().Resolve(context.Background(), nil, domain.BundleConfig{})
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrMissingModel))
}

// chatRequest is the ordinary case the resolution tests exercise: a model
// arriving as a top-level JSON field on a chat completion.
func chatRequest(model string) *domain.Request {
	return &domain.Request{Type: domain.RequestTypeChat, Model: model}
}

func TestResolve_EmptyAllowlist_AllowsAll(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{
		AllowedModels: []string{},
	}

	got, err := r.Resolve(context.Background(), chatRequest("anything-goes"), cfg)
	require.NoError(t, err)
	assert.Equal(t, "anything-goes", got.ModelID)
}

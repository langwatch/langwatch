package httpapi

// Binds specs/ai-gateway/audio-endpoints.feature: the @unit scenarios for
// POST /v1/audio/speech and POST /v1/audio/transcriptions: routing, multipart
// parsing, the size cap, missing-field errors, allowlist enforcement, and
// binary response writing. The @integration/@e2e scenarios run live via the
// tests/matrix audio cells and the Scenario-voice dogfood run.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
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

// audioRouter builds an audio-capable router. Extra credentials are
// appended to the default bundle so a test asking for a non-OpenAI
// provider prefix has the matching slot bound — without one the
// dispatcher rejects the request as model_provider_not_bound before
// the provider is ever reached.
func audioRouter(capture *domain.Request, extraCreds ...domain.Credential) http.Handler {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (*domain.Response, error) {
			if capture != nil {
				*capture = *req
			}
			switch req.Type {
			case domain.RequestTypeSpeech:
				return &domain.Response{
					Body:       []byte("RIFF-fake-pcm-bytes"),
					StatusCode: http.StatusOK,
					Headers:    map[string]string{"Content-Type": "audio/pcm"},
					Usage:      domain.Usage{InputChars: 23},
				}, nil
			case domain.RequestTypeTranscription:
				return &domain.Response{
					Body:       []byte(`{"text":"hello from the fake provider"}`),
					StatusCode: http.StatusOK,
					Usage:      domain.Usage{AudioSeconds: 1.5},
				}, nil
			default:
				return successResponse(), nil
			}
		},
	}
	return buildRouter(
		app.WithAuth(audioAuth(extraCreds...)),
		app.WithProviders(provider),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)
}

// audioAuth resolves every key to the default bundle plus extraCreds.
func audioAuth(extraCreds ...domain.Credential) *mockAuth {
	return &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			b := testBundle()
			b.Credentials = append(b.Credentials, extraCreds...)
			return b, nil
		},
	}
}

func multipartBody(t *testing.T, fields map[string]string, fileField, filename string, fileBytes []byte) (*bytes.Buffer, string) {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	for k, v := range fields {
		require.NoError(t, w.WriteField(k, v))
	}
	if fileField != "" {
		fw, err := w.CreateFormFile(fileField, filename)
		require.NoError(t, err)
		_, err = fw.Write(fileBytes)
		require.NoError(t, err)
	}
	require.NoError(t, w.Close())
	return buf, w.FormDataContentType()
}

// --- /v1/audio/speech ---

// @scenario "OpenAI-shape TTS request returns binary audio"
func TestAudioSpeech_ReturnsBinaryAudioWithContentType(t *testing.T) {
	var captured domain.Request
	router := audioRouter(&captured)

	body := `{"model":"openai/gpt-4o-mini-tts","voice":"nova","input":"Hello from the gateway.","response_format":"pcm"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/speech", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	// Raw bytes, no JSON envelope; an OpenAI SDK consumes this unchanged.
	assert.Equal(t, "RIFF-fake-pcm-bytes", rec.Body.String())
	assert.Equal(t, "audio/pcm", rec.Header().Get("Content-Type"))

	assert.Equal(t, domain.RequestTypeSpeech, captured.Type)
	require.NotNil(t, captured.Resolved)
	assert.Equal(t, "gpt-4o-mini-tts", captured.Resolved.ModelID)
	assert.Equal(t, domain.ProviderOpenAI, captured.Resolved.ProviderID)
}

func TestAudioSpeech_ElevenLabsModelResolvesToElevenLabsProvider(t *testing.T) {
	var captured domain.Request
	router := audioRouter(&captured, domain.Credential{
		ID: "cred-11labs", ProviderID: domain.ProviderElevenLabs, APIKey: "sk-11labs-test",
	})

	body := `{"model":"elevenlabs/eleven_flash_v2","voice":"cjVigY5qzO86Huf0OWal","input":"Hola."}`
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/speech", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, captured.Resolved)
	assert.Equal(t, "eleven_flash_v2", captured.Resolved.ModelID)
	assert.Equal(t, domain.ProviderElevenLabs, captured.Resolved.ProviderID)
}

// @scenario "The virtual key's model allowlist applies"
func TestAudioSpeech_ModelAllowlistApplies(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			b := testBundle()
			b.Config.AllowedModels = []string{"gpt-5-mini"}
			return b, nil
		},
	}
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			// A t.Fatal here would Goexit the heartbeat goroutine and wedge
			// the handler; record and assert from the test goroutine instead.
			dispatched = true
			return successResponse(), nil
		},
	}
	router := buildRouter(app.WithAuth(auth), app.WithProviders(provider),
		app.WithModels(modelresolver.New()), app.WithLogger(zap.NewNop()))

	body := `{"model":"openai/gpt-4o-mini-tts","voice":"nova","input":"hi"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/speech", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Same status the chat endpoint returns for a disallowed model (the
	// registered mapping for model_not_allowed).
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "model_not_allowed")
	assert.False(t, dispatched, "provider must not be contacted for a disallowed model")
}

// @scenario "Audio requests authenticate exactly like chat"
func TestAudioSpeech_RequiresAuthLikeChat(t *testing.T) {
	router := audioRouter(nil)

	req := httptest.NewRequest(http.MethodPost, "/v1/audio/speech", strings.NewReader(`{"model":"gpt-4o-mini-tts"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

// --- /v1/audio/transcriptions ---

// @scenario "OpenAI-shape multipart transcription returns the transcript JSON"
func TestAudioTranscriptions_MultipartHappyPath(t *testing.T) {
	var captured domain.Request
	router := audioRouter(&captured)

	buf, contentType := multipartBody(t,
		map[string]string{"model": "openai/gpt-4o-transcribe", "language": "en"},
		"file", "turn.wav", []byte("fake-wav-bytes"))
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/transcriptions", buf)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var parsed struct {
		Text string `json:"text"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &parsed))
	assert.Equal(t, "hello from the fake provider", parsed.Text)

	assert.Equal(t, domain.RequestTypeTranscription, captured.Type)
	require.NotNil(t, captured.Transcription)
	assert.Equal(t, []byte("fake-wav-bytes"), captured.Transcription.File)
	assert.Equal(t, "turn.wav", captured.Transcription.Filename)
	assert.Equal(t, "en", captured.Transcription.Params["language"])
	require.NotNil(t, captured.Resolved)
	assert.Equal(t, "gpt-4o-transcribe", captured.Resolved.ModelID)
}

// @scenario "A multipart request with no file part fails informatively"
func TestAudioTranscriptions_MissingFileIs400BeforeDispatch(t *testing.T) {
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}
	auth := &mockAuth{resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) { return testBundle(), nil }}
	router := buildRouter(app.WithAuth(auth), app.WithProviders(provider),
		app.WithModels(modelresolver.New()), app.WithLogger(zap.NewNop()))

	buf, contentType := multipartBody(t, map[string]string{"model": "openai/gpt-4o-transcribe"}, "", "", nil)
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/transcriptions", buf)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "file")
	assert.False(t, dispatched, "provider must not be contacted without a file")
}

// @scenario "Oversized uploads are rejected before provider dispatch"
func TestAudioTranscriptions_OversizedUploadIs413BeforeDispatch(t *testing.T) {
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}
	auth := &mockAuth{resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) { return testBundle(), nil }}
	router := buildRouter(app.WithAuth(auth), app.WithProviders(provider),
		app.WithModels(modelresolver.New()), app.WithLogger(zap.NewNop()))

	// One byte past the cap. The handler must reject while parsing, without
	// buffering the whole body into a provider request.
	big := bytes.Repeat([]byte("a"), maxTranscriptionBodyBytes+1)
	buf, contentType := multipartBody(t, map[string]string{"model": "openai/gpt-4o-transcribe"}, "file", "big.wav", big)
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/transcriptions", buf)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.False(t, dispatched, "provider must not be contacted for an oversized upload")
}

func TestAudioTranscriptions_UnknownFormFieldsAreDropped(t *testing.T) {
	var captured domain.Request
	router := audioRouter(&captured)

	buf, contentType := multipartBody(t,
		map[string]string{"model": "openai/gpt-4o-transcribe", "evil_field": "1; DROP TABLE"},
		"file", "turn.wav", []byte("bytes"))
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/transcriptions", buf)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	_, present := captured.Transcription.Params["evil_field"]
	assert.False(t, present, "unknown form fields must not be forwarded")
}

// Guard: the speech success path must never be wrapped in a JSON envelope by
// a future refactor: a body that starts with '{' would break every OpenAI
// SDK's `audio.speech.create`, which hands the bytes straight to the caller.
// @scenario "PCM response format passes through for realtime consumers"
func TestAudioSpeech_BodyIsNotJSONWrapped(t *testing.T) {
	router := audioRouter(nil)

	body := `{"model":"openai/gpt-4o-mini-tts","voice":"nova","input":"hi","response_format":"mp3"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/speech", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	first, _ := io.ReadAll(io.LimitReader(bytes.NewReader(rec.Body.Bytes()), 1))
	assert.NotEqual(t, byte('{'), first[0])
}

// --- governance parity ---

// @scenario "A bare model name resolves like chat models do"
func TestAudioSpeech_BareModelNameResolvesLikeChat(t *testing.T) {
	// Bare names ride the same resolver as chat: no provider pin (credential
	// eligibility picks the provider, exactly like /v1/chat/completions)...
	var captured domain.Request
	router := audioRouter(&captured)

	body := `{"model":"gpt-4o-mini-tts","voice":"nova","input":"Hi."}`
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/speech", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, captured.Resolved)
	assert.Equal(t, "gpt-4o-mini-tts", captured.Resolved.ModelID)
	assert.Empty(t, captured.Resolved.ProviderID,
		"a bare name must not pin a provider; credential eligibility decides, as in chat")

	// ...and the virtual key's allowlist gates the bare form the same way.
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			b := testBundle()
			b.Config.AllowedModels = []string{"gpt-5-mini"}
			return b, nil
		},
	}
	gated := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(&mockProvider{}),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)
	req = httptest.NewRequest(http.MethodPost, "/v1/audio/speech", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec = httptest.NewRecorder()
	gated.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "model_not_allowed")
}

// @scenario "Budgets and rate limits gate audio calls"
func TestAudioSpeech_BudgetBlockGatesLikeChat(t *testing.T) {
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}
	block := &mockBudget{
		precheckFn: func(_ context.Context, _ *domain.Bundle) (domain.BudgetDecision, error) {
			return domain.BudgetDecision{Verdict: domain.BudgetBlock}, nil
		},
	}
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithModels(modelresolver.New()),
		app.WithBudget(block),
		app.WithLogger(zap.NewNop()),
	)

	body := `{"model":"openai/gpt-4o-mini-tts","voice":"nova","input":"Hi."}`
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/speech", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusPaymentRequired, rec.Code)
	assert.Contains(t, rec.Body.String(), "budget_exceeded")
	assert.False(t, dispatched, "a blocked call must not reach the provider")
}

// @scenario "A missing provider key is a clear terminal error"
func TestAudioSpeech_NoProviderConfiguredIsTerminal(t *testing.T) {
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			b := testBundle()
			b.Credentials = nil
			return b, nil
		},
	}
	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)

	body := `{"model":"elevenlabs/eleven_flash_v2","voice":"cjVigY5qzO86Huf0OWal","input":"Hi."}`
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/speech", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "no_provider_configured")
	assert.False(t, dispatched, "with zero credentials nothing must reach the provider")
}

// @scenario "Upstream provider errors pass through transparently"
func TestAudioSpeech_UpstreamProviderErrorPassesThrough(t *testing.T) {
	providerBody := `{"detail":{"status":"voice_not_found","message":"A voice with that voice_id was not found."}}`
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return &domain.Response{
				StatusCode: http.StatusBadRequest,
				Body:       []byte(providerBody),
				Headers:    map[string]string{"Content-Type": "application/json"},
			}, nil
		},
	}
	auth := audioAuth(domain.Credential{
		ID: "cred-11labs", ProviderID: domain.ProviderElevenLabs, APIKey: "sk-11labs-test",
	})
	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)

	body := `{"model":"elevenlabs/eleven_flash_v2","voice":"nope","input":"Hi."}`
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/speech", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.JSONEq(t, providerBody, rec.Body.String())
}

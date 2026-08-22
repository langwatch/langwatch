package httpapi

// The HTTP boundary of ElevenLabs' own audio routes: what an ElevenLabs SDK
// sends, what the pipeline is handed, and what comes back.
//
// Binds specs/ai-gateway/audio-endpoints.feature.

import (
	"bytes"
	"context"
	"encoding/json"
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

func elevenLabsCred() domain.Credential {
	return domain.Credential{
		ID: "cred-11labs", ProviderID: domain.ProviderElevenLabs, APIKey: "sk-11labs-test",
	}
}

// nativeAudioRouter answers both native routes with vendor-shaped bodies.
func nativeAudioRouter(capture *domain.Request, creds ...domain.Credential) http.Handler {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (*domain.Response, error) {
			if capture != nil {
				*capture = *req
			}
			if req.Type == domain.RequestTypeSpeech {
				return &domain.Response{
					Body:       []byte("ID3-fake-mp3-bytes"),
					StatusCode: http.StatusOK,
					Headers:    map[string]string{"Content-Type": "audio/mpeg"},
					Usage:      domain.Usage{InputChars: 33},
				}, nil
			}
			return &domain.Response{
				Body:       []byte(`{"text":"hello","audio_duration_secs":1.99}`),
				StatusCode: http.StatusOK,
				Usage:      domain.Usage{AudioSeconds: 1.99},
			}, nil
		},
	}
	return buildRouter(
		app.WithAuth(audioAuth(creds...)),
		app.WithProviders(provider),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)
}

// @scenario "An ElevenLabs SDK reaches the native audio routes unchanged"
func TestElevenLabsNativeSpeech_ForwardsVoiceQueryAndAudioBytes(t *testing.T) {
	var captured domain.Request
	router := nativeAudioRouter(&captured, elevenLabsCred())

	body := `{"text":"Hello from the LangWatch gateway.","model_id":"eleven_flash_v2_5"}`
	req := httptest.NewRequest(http.MethodPost,
		"/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_44100_128",
		strings.NewReader(body))
	// The vendor's own auth header, so an ElevenLabs SDK needs only its base
	// URL changed.
	req.Header.Set("xi-api-key", "vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "ID3-fake-mp3-bytes", rec.Body.String(),
		"the audio must reach the caller with no JSON envelope around it")
	assert.Equal(t, "audio/mpeg", rec.Header().Get("Content-Type"))

	assert.Equal(t, domain.RequestTypeSpeech, captured.Type)
	require.NotNil(t, captured.ElevenLabs)
	assert.Equal(t, "EXAVITQu4vr4xnSDxMaL", captured.ElevenLabs.VoiceID)
	assert.Equal(t, "output_format=mp3_44100_128", captured.ElevenLabs.RawQuery)
	assert.Equal(t, domain.ElevenLabsSpeechSurface(), captured.Surface)
	require.NotNil(t, captured.Resolved)
	assert.Equal(t, "eleven_flash_v2_5", captured.Resolved.ModelID)
}

// A provider-prefixed spelling is rewritten into the vendor's own field, not
// into the "model" field no ElevenLabs endpoint reads.
func TestElevenLabsNativeSpeech_ResolvedModelLandsInModelId(t *testing.T) {
	var captured domain.Request
	router := nativeAudioRouter(&captured, elevenLabsCred())

	body := `{"text":"Hi.","model_id":"elevenlabs/eleven_flash_v2_5"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/text-to-speech/voice_1", strings.NewReader(body))
	req.Header.Set("xi-api-key", "vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var sent map[string]any
	require.NoError(t, json.Unmarshal(captured.Body, &sent))
	assert.Equal(t, "eleven_flash_v2_5", sent["model_id"])
	assert.NotContains(t, sent, "model",
		`a stray "model" field is not part of this vendor's wire and must not be invented`)
}

// A request that names no model still bills and gates against a model, so the
// virtual key's allowlist applies to it exactly as it does to a stated one.
func TestElevenLabsNativeSpeech_NoModelUsesTheVendorsOwnDefault(t *testing.T) {
	var captured domain.Request
	router := nativeAudioRouter(&captured, elevenLabsCred())

	req := httptest.NewRequest(http.MethodPost, "/v1/text-to-speech/voice_1",
		strings.NewReader(`{"text":"Hi."}`))
	req.Header.Set("xi-api-key", "vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, captured.Resolved)
	assert.Equal(t, domain.ElevenLabsDefaultSpeechModel, captured.Resolved.ModelID)
}

func TestElevenLabsNativeSpeech_MissingTextIsRefusedBeforeAnyProvider(t *testing.T) {
	dispatched := false
	router := buildRouter(
		app.WithAuth(audioAuth(elevenLabsCred())),
		app.WithProviders(&mockProvider{
			dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
				dispatched = true
				return successResponse(), nil
			},
		}),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/text-to-speech/voice_1",
		strings.NewReader(`{"model_id":"eleven_flash_v2_5"}`))
	req.Header.Set("xi-api-key", "vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "text")
	assert.False(t, dispatched, "no provider may be contacted for a request that speaks nothing")
}

// @scenario "ElevenLabs' own transcription path reaches the vendor unchanged"
func TestElevenLabsNativeTranscription_CarriesEveryVendorFormField(t *testing.T) {
	var captured domain.Request
	router := nativeAudioRouter(&captured, elevenLabsCred())

	form, contentType := multipartBody(t, map[string]string{
		"model_id":               "scribe_v1",
		"diarize":                "true",
		"timestamps_granularity": "word",
	}, "file", "clip.wav", []byte("RIFF-fake-wav"))
	req := httptest.NewRequest(http.MethodPost, "/v1/speech-to-text", form)
	req.Header.Set("xi-api-key", "vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"text":"hello","audio_duration_secs":1.99}`, rec.Body.String())

	assert.Equal(t, domain.RequestTypeTranscription, captured.Type)
	assert.Equal(t, domain.ElevenLabsTranscriptionSurface(), captured.Surface)
	require.NotNil(t, captured.Transcription)
	assert.Equal(t, "RIFF-fake-wav", string(captured.Transcription.File))
	assert.Equal(t, "clip.wav", captured.Transcription.Filename)
	// Filtering to a known list would drop this vendor's settings the moment
	// it adds one, on a route whose whole point is carrying them.
	assert.Equal(t, "true", captured.Transcription.Params["diarize"])
	assert.Equal(t, "word", captured.Transcription.Params["timestamps_granularity"])
	require.NotNil(t, captured.Resolved)
	assert.Equal(t, "scribe_v1", captured.Resolved.ModelID)
}

func TestElevenLabsNativeTranscription_MissingModelNamesTheFormFieldThisRouteReads(t *testing.T) {
	router := nativeAudioRouter(nil, elevenLabsCred())

	form, contentType := multipartBody(t, nil, "file", "clip.wav", []byte("RIFF-fake-wav"))
	req := httptest.NewRequest(http.MethodPost, "/v1/speech-to-text", form)
	req.Header.Set("xi-api-key", "vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	body := rec.Body.String()
	assert.Contains(t, body, "model_id",
		"naming the OpenAI route's own field would send the caller to fix one this endpoint never reads")
	assert.Contains(t, body, "/v1/speech-to-text")
}

// The branch that decides 400 against 200 at the HTTP boundary: this vendor
// fetches a cloud_storage_url itself, so an upload with no file part is a
// complete request rather than a missing one.
func TestElevenLabsNativeTranscription_AcceptsACloudStorageURLWithNoFile(t *testing.T) {
	var captured domain.Request
	router := nativeAudioRouter(&captured, elevenLabsCred())

	form, contentType := multipartBody(t, map[string]string{
		"model_id":          "scribe_v1",
		"cloud_storage_url": "https://example.test/clip.mp3",
	}, "", "", nil)
	req := httptest.NewRequest(http.MethodPost, "/v1/speech-to-text", form)
	req.Header.Set("xi-api-key", "vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, captured.Transcription)
	assert.Empty(t, captured.Transcription.File)
	assert.Equal(t, "https://example.test/clip.mp3",
		captured.Transcription.Params["cloud_storage_url"])
}

// @scenario "Asynchronous transcription is refused rather than billed at zero"
func TestElevenLabsNativeTranscription_AsyncWebhookIsRefused(t *testing.T) {
	// Every spelling a form part uses for true, because the one that slips
	// through is the one that bills nothing.
	for _, value := range []string{"true", "TRUE", "1", "yes", " on "} {
		t.Run(value, func(t *testing.T) {
			dispatched := false
			router := buildRouter(
				app.WithAuth(audioAuth(elevenLabsCred())),
				app.WithProviders(&mockProvider{
					dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
						dispatched = true
						return successResponse(), nil
					},
				}),
				app.WithModels(modelresolver.New()),
				app.WithLogger(zap.NewNop()),
			)

			form, contentType := multipartBody(t, map[string]string{
				"model_id": "scribe_v1",
				"webhook":  value,
			}, "file", "clip.wav", []byte("RIFF-fake-wav"))
			req := httptest.NewRequest(http.MethodPost, "/v1/speech-to-text", form)
			req.Header.Set("xi-api-key", "vk-lw-test")
			req.Header.Set("Content-Type", contentType)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			assert.Equal(t, http.StatusBadRequest, rec.Code)
			assert.Contains(t, rec.Body.String(), "webhook")
			assert.False(t, dispatched,
				"an async request carries no duration to bill, so it must not reach the vendor")
		})
	}
}

// A webhook part that is not asking for the async mode is just another form
// field, and refusing it would break a caller that never opted in.
func TestElevenLabsNativeTranscription_AFalseWebhookPartIsNotRefused(t *testing.T) {
	var captured domain.Request
	router := nativeAudioRouter(&captured, elevenLabsCred())

	form, contentType := multipartBody(t, map[string]string{
		"model_id": "scribe_v1",
		"webhook":  "false",
	}, "file", "clip.wav", []byte("RIFF-fake-wav"))
	req := httptest.NewRequest(http.MethodPost, "/v1/speech-to-text", form)
	req.Header.Set("xi-api-key", "vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, captured.Transcription)
	assert.Equal(t, "false", captured.Transcription.Params["webhook"])
}

func TestElevenLabsNativeTranscription_NoAudioAtAllIsRefused(t *testing.T) {
	router := nativeAudioRouter(nil, elevenLabsCred())

	form, contentType := multipartBody(t, map[string]string{"model_id": "scribe_v1"}, "", "", nil)
	req := httptest.NewRequest(http.MethodPost, "/v1/speech-to-text", form)
	req.Header.Set("xi-api-key", "vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "cloud_storage_url")
}

// @scenario "A native ElevenLabs route refuses a key with no ElevenLabs credential"
func TestElevenLabsNativeRoutes_RefuseAKeyWithNoElevenLabsCredential(t *testing.T) {
	dispatched := false
	// No ElevenLabs credential: the default bundle carries OpenAI only. The
	// body is this vendor's own wire, so forwarding it to whichever provider
	// the key does hold would spend a credential the caller never named on an
	// API that cannot read the request.
	router := buildRouter(
		app.WithAuth(audioAuth()),
		app.WithProviders(&mockProvider{
			dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
				dispatched = true
				return successResponse(), nil
			},
		}),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)

	speech := httptest.NewRequest(http.MethodPost, "/v1/text-to-speech/voice_1",
		strings.NewReader(`{"text":"Hi.","model_id":"eleven_flash_v2_5"}`))
	speech.Header.Set("xi-api-key", "vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, speech)
	assert.GreaterOrEqual(t, rec.Code, 400)
	assert.Contains(t, strings.ToLower(rec.Body.String()), "elevenlabs")

	form, contentType := multipartBody(t, map[string]string{"model_id": "scribe_v1"},
		"file", "clip.wav", []byte("RIFF-fake-wav"))
	stt := httptest.NewRequest(http.MethodPost, "/v1/speech-to-text", form)
	stt.Header.Set("xi-api-key", "vk-lw-test")
	stt.Header.Set("Content-Type", contentType)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, stt)
	assert.GreaterOrEqual(t, rec.Code, 400)

	assert.False(t, dispatched, "neither request may reach a provider the route does not name")
}

// @scenario "The virtual key's model allowlist applies"
func TestElevenLabsNativeRoutes_ModelAllowlistApplies(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			b := testBundle()
			b.Credentials = append(b.Credentials, elevenLabsCred())
			b.Config.AllowedModels = []string{"eleven_flash_v2_5"}
			return b, nil
		},
	}
	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(&mockProvider{
			dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
				return successResponse(), nil
			},
		}),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/text-to-speech/voice_1",
		strings.NewReader(`{"text":"Hi.","model_id":"eleven_multilingual_v2"}`))
	req.Header.Set("xi-api-key", "vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// The same status and code the chat endpoint returns for a disallowed model.
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "model_not_allowed")
	assert.Contains(t, rec.Body.String(), "eleven_multilingual_v2")
}

// The router's own routing, so a missing route is told apart from a vendor
// 404: chi answers an unmounted path in plain text with no gateway headers.
func TestElevenLabsNativeRoutes_AreMounted(t *testing.T) {
	router := nativeAudioRouter(nil, elevenLabsCred())

	for _, path := range []string{"/v1/text-to-speech/voice_1", "/v1/speech-to-text"} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(nil))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.NotEqual(t, "404 page not found\n", rec.Body.String(),
			"%s must be a mounted route, not chi's unrouted answer", path)
	}
}

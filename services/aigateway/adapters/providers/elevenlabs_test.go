package providers

// The ElevenLabs-native audio dispatch: what reaches the vendor, what comes
// back, and the quantity each route is metered by.
//
// Binds specs/ai-gateway/audio-endpoints.feature.

import (
	"context"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func elevenLabsAudioRouter(server *httptest.Server) *BifrostRouter {
	return &BifrostRouter{elevenLabsClient: server.Client()}
}

// @scenario "ElevenLabs' own synthesis path reaches the vendor unchanged"
func TestElevenLabsSpeechForwardsTheCallersBodyAndMetersCharacters(t *testing.T) {
	t.Parallel()

	var gotPath, gotQuery, gotKey, gotContentType string
	var gotBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery = r.URL.Path, r.URL.RawQuery
		gotKey, gotContentType = r.Header.Get("xi-api-key"), r.Header.Get("Content-Type")
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Header().Set("Request-Id", "vendor_req_1")
		// The vendor states credits under the account's plan here, which is
		// not a character count. Present so the assertion below proves it is
		// ignored.
		w.Header().Set("character-cost", "9")
		_, _ = w.Write([]byte("ID3-fake-mp3-bytes"))
	}))
	defer server.Close()

	body := []byte(`{"text":"Olá, mundo","model_id":"eleven_flash_v2_5","voice_settings":{"speed":1.1}}`)
	req := &domain.Request{
		Type:       domain.RequestTypeSpeech,
		Model:      "eleven_flash_v2_5",
		Body:       body,
		ElevenLabs: &domain.ElevenLabsAudioRequest{VoiceID: "voice 9", RawQuery: "output_format=mp3_44100_128"},
		Surface:    domain.ElevenLabsSpeechSurface(),
	}
	resp, err := elevenLabsAudioRouter(server).dispatchElevenLabsSpeech(
		context.Background(), req, elevenLabsCredential(server))
	require.NoError(t, err)

	assert.Equal(t, "/v1/text-to-speech/voice 9", gotPath,
		"the voice is a path segment, so a space in it must be escaped rather than dropped")
	assert.Equal(t, "output_format=mp3_44100_128", gotQuery,
		"this vendor takes the audio format in the query, so dropping it returns a format nobody asked for")
	assert.Equal(t, "xi-secret", gotKey)
	assert.Equal(t, "application/json", gotContentType)
	assert.JSONEq(t, string(body), string(gotBody),
		"the caller's own voice settings must reach the vendor untouched")

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "ID3-fake-mp3-bytes", string(resp.Body))
	assert.Equal(t, "audio/mpeg", resp.Headers["Content-Type"])
	assert.Equal(t, "vendor_req_1", resp.Headers["Request-Id"])
	// Ten runes, not eleven bytes: "Olá, mundo" carries a two-byte á, and the
	// OpenAI-wire route counts runes too, so the same call bills the same on
	// either wire.
	assert.Equal(t, 10, resp.Usage.InputChars)
	assert.Zero(t, resp.Usage.AudioSeconds)
}

// @scenario "ElevenLabs' own transcription path reaches the vendor unchanged"
func TestElevenLabsTranscriptionRebuildsTheFormAndMetersDuration(t *testing.T) {
	t.Parallel()

	var gotPath, gotKey string
	gotFields := map[string]string{}
	var gotFile []byte
	var gotFilename string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotKey = r.URL.Path, r.Header.Get("xi-api-key")
		_, params, parseErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if !assert.NoError(t, parseErr) {
			return
		}
		reader := multipart.NewReader(r.Body, params["boundary"])
		for {
			part, partErr := reader.NextPart()
			if partErr != nil {
				break
			}
			data, _ := io.ReadAll(part)
			if part.FileName() != "" {
				gotFile, gotFilename = data, part.FileName()
				continue
			}
			gotFields[part.FormName()] = string(data)
		}
		w.Header().Set("Content-Type", "application/json")
		// audio_duration_secs is the vendor's own measure and runs past the
		// last word, which is why it is preferred over the word timings.
		_, _ = w.Write([]byte(
			`{"text":"hello","audio_duration_secs":1.9969375,"words":[{"text":"hello","start":0.079,"end":0.459}]}`))
	}))
	defer server.Close()

	req := &domain.Request{
		Type:  domain.RequestTypeTranscription,
		Model: "scribe_v1",
		Transcription: &domain.TranscriptionUpload{
			File:     []byte("RIFF-fake-wav"),
			Filename: "clip.wav",
			Params: map[string]string{
				"model_id":     "elevenlabs/scribe_v1",
				"diarize":      "true",
				"num_speakers": "2",
			},
		},
		ElevenLabs: &domain.ElevenLabsAudioRequest{},
		Surface:    domain.ElevenLabsTranscriptionSurface(),
	}
	resp, err := elevenLabsAudioRouter(server).dispatchElevenLabsTranscription(
		context.Background(), req, elevenLabsCredential(server))
	require.NoError(t, err)

	assert.Equal(t, "/v1/speech-to-text", gotPath)
	assert.Equal(t, "xi-secret", gotKey)
	assert.Equal(t, "RIFF-fake-wav", string(gotFile))
	assert.Equal(t, "clip.wav", gotFilename)
	assert.Equal(t, "scribe_v1", gotFields["model_id"],
		"the resolved model replaces whatever spelling the caller sent")
	assert.Equal(t, "true", gotFields["diarize"],
		"this vendor's own settings are the request on a route that mirrors its path")
	assert.Equal(t, "2", gotFields["num_speakers"])

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.InDelta(t, 1.9969375, resp.Usage.AudioSeconds, 1e-9)
	assert.Zero(t, resp.Usage.InputChars)
}

// A vendor rejection is forwarded as the vendor wrote it, which is what lets
// the retry walk classify the status rather than see a gateway 500.
func TestElevenLabsAudioForwardsAVendorRejectionVerbatim(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"detail":{"status":"voice_not_found"}}`))
	}))
	defer server.Close()

	req := &domain.Request{
		Type:       domain.RequestTypeSpeech,
		Model:      "eleven_flash_v2_5",
		Body:       []byte(`{"text":"hi"}`),
		ElevenLabs: &domain.ElevenLabsAudioRequest{VoiceID: "nope"},
	}
	resp, err := elevenLabsAudioRouter(server).dispatchElevenLabsSpeech(
		context.Background(), req, elevenLabsCredential(server))
	require.NoError(t, err)

	assert.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	assert.JSONEq(t, `{"detail":{"status":"voice_not_found"}}`, string(resp.Body))
	assert.Zero(t, resp.Usage.InputChars,
		"a call the vendor refused synthesized nothing, so it must not be billed for characters")
}

// A cloud_storage_url request carries no file part, and refusing it here
// would break a path the vendor supports.
func TestElevenLabsTranscriptionAcceptsACloudStorageURLWithNoFile(t *testing.T) {
	t.Parallel()

	sawFile := false
	gotFields := map[string]string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, params, parseErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if !assert.NoError(t, parseErr) {
			return
		}
		reader := multipart.NewReader(r.Body, params["boundary"])
		for {
			part, partErr := reader.NextPart()
			if partErr != nil {
				break
			}
			data, _ := io.ReadAll(part)
			if part.FileName() != "" {
				sawFile = true
				continue
			}
			gotFields[part.FormName()] = string(data)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"hello","audio_duration_secs":12.5}`))
	}))
	defer server.Close()

	req := &domain.Request{
		Type:  domain.RequestTypeTranscription,
		Model: "scribe_v1",
		Transcription: &domain.TranscriptionUpload{
			Params: map[string]string{"cloud_storage_url": "https://example.test/clip.mp3"},
		},
		ElevenLabs: &domain.ElevenLabsAudioRequest{},
	}
	resp, err := elevenLabsAudioRouter(server).dispatchElevenLabsTranscription(
		context.Background(), req, elevenLabsCredential(server))
	require.NoError(t, err)

	assert.False(t, sawFile, "no audio was uploaded, so no file part may be invented")
	assert.Equal(t, "https://example.test/clip.mp3", gotFields["cloud_storage_url"])
	assert.InDelta(t, 12.5, resp.Usage.AudioSeconds, 1e-9)
}

// The redirect refusal is why this client exists rather than a shared one:
// Go strips Authorization across hosts but not xi-api-key, so a followed
// redirect from a customer-configured base URL would hand the customer's
// ElevenLabs key to whatever host answered. Built through the real
// constructor, because the injected test client in every case above bypasses
// exactly the configuration under test here.
func TestElevenLabsAudioClientDoesNotFollowRedirects(t *testing.T) {
	t.Parallel()

	leaked := make(chan string, 1)
	elsewhere := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked <- r.Header.Get("xi-api-key")
		w.WriteHeader(http.StatusOK)
	}))
	defer elsewhere.Close()

	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere.URL+"/v1/text-to-speech/voice_1", http.StatusFound)
	}))
	defer vendor.Close()

	client := newElevenLabsAudioClient(newCustomerEndpointPolicy(false, false, nil))
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, vendor.URL, nil)
	require.NoError(t, err)
	req.Header.Set("xi-api-key", "xi-secret")

	resp, err := client.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	assert.Equal(t, http.StatusFound, resp.StatusCode,
		"the redirect must be returned to the caller, never followed")
	select {
	case key := <-leaked:
		t.Fatalf("the redirect target received the provider key %q", key)
	default:
	}
}

func TestElevenLabsTranscribedSecondsFallsBackToWordTimings(t *testing.T) {
	t.Parallel()

	for name, tc := range map[string]struct {
		body string
		want float64
	}{
		"the stated duration wins over the last word": {
			body: `{"audio_duration_secs":2.5,"words":[{"end":1.7}]}`,
			want: 2.5,
		},
		"word timings answer when no duration is stated": {
			body: `{"words":[{"end":0.4},{"end":1.75}]}`,
			want: 1.75,
		},
		"the multi-channel shape nests its transcripts": {
			body: `{"transcripts":[{"words":[{"end":0.9}]},{"words":[{"end":3.25}]}]}`,
			want: 3.25,
		},
		"a body with neither measures nothing": {
			body: `{"text":"hello"}`,
			want: 0,
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			assert.InDelta(t, tc.want, elevenLabsTranscribedSeconds([]byte(tc.body)), 1e-9)
		})
	}
}

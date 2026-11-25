package httpapi

// Audio routes against the real providers: the real router and the real
// provider dispatch, with the provider keys read from the environment. Off
// unless GATEWAY_LIVE_AUDIO=1, because every call here is billed.
//
//	GATEWAY_LIVE_AUDIO=1 OPENAI_API_KEY=... ELEVENLABS_API_KEY=... \
//	  go test ./adapters/httpapi/ -run TestLiveAudio -count=1 -v
//
// Binds specs/ai-gateway/audio-endpoints.feature.

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/providers"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type liveAudioGateway struct {
	url   string
	spend *spendLedger
}

// newLiveAudioGateway serves the router over a real socket with the real
// providers behind it. It skips the test when the run is not opted in.
func newLiveAudioGateway(t *testing.T, keys ...string) *liveAudioGateway {
	t.Helper()
	if os.Getenv("GATEWAY_LIVE_AUDIO") != "1" {
		t.Skip("GATEWAY_LIVE_AUDIO is not 1: live provider calls are opt-in")
	}
	var creds []domain.Credential
	for _, key := range keys {
		value := os.Getenv(key)
		require.NotEmpty(t, value, "%s is required for this live test", key)
		provider := domain.ProviderOpenAI
		if key == "ELEVENLABS_API_KEY" {
			provider = domain.ProviderElevenLabs
		}
		creds = append(creds, domain.Credential{ID: "cred-" + string(provider), ProviderID: provider, APIKey: value})
	}
	bf, err := providers.NewBifrostRouter(context.Background(), providers.BifrostOptions{Logger: zap.NewNop()})
	require.NoError(t, err)
	t.Cleanup(bf.Close)

	gw := &liveAudioGateway{spend: &spendLedger{}}
	auth := &mockAuth{resolveFn: func(context.Context, string) (*domain.Bundle, error) {
		b := testBundle()
		b.Credentials = creds
		return b, nil
	}}
	server := httptest.NewServer(buildRouter(
		app.WithAuth(auth), app.WithProviders(bf), app.WithModels(modelresolver.New()),
		app.WithSpend(gw.spend), app.WithLogger(zap.NewNop()),
	))
	t.Cleanup(server.Close)
	gw.url = server.URL
	return gw
}

func (g *liveAudioGateway) do(t *testing.T, path, contentType string, body io.Reader) (*http.Response, []byte, time.Duration) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, g.url+path, body)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	start := time.Now()
	resp, err := (&http.Client{Timeout: 4 * time.Minute}).Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	first := make([]byte, 1)
	_, _ = io.ReadFull(resp.Body, first)
	ttfb := time.Since(start)
	rest, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp, append(first, rest...), ttfb
}

// speakWAV synthesizes text through the gateway and returns the WAV bytes.
func (g *liveAudioGateway) speakWAV(t *testing.T, voice, text string) []byte {
	t.Helper()
	body := `{"model":"openai/gpt-4o-mini-tts","voice":"` + voice + `","response_format":"wav","input":` +
		gjson.Parse(`"`+text+`"`).Raw + `}`
	resp, audio, ttfb := g.do(t, "/v1/audio/speech", "application/json", strings.NewReader(body))
	require.Equal(t, http.StatusOK, resp.StatusCode, string(audio[:min(len(audio), 400)]))
	require.Greater(t, len(audio), 10_000, "real audio is more than a few kilobytes")
	t.Logf("speech: %d bytes of %s, first byte after %v", len(audio), resp.Header.Get("Content-Type"), ttfb)
	return audio
}

const liveShortLine = "Hello there. This is a short test of speaker labels."

// @scenario "A diarized transcription of a short clip succeeds against the real provider"
func TestLiveAudio_DiarizedShortClip(t *testing.T) {
	gw := newLiveAudioGateway(t, "OPENAI_API_KEY")
	clip := gw.speakWAV(t, "alloy", liveShortLine)

	buf := &bytes.Buffer{}
	contentType := writeTranscriptionForm(t, buf, clip, [][2]string{
		{"model", "openai/gpt-4o-transcribe-diarize"},
		{"response_format", "diarized_json"},
		{"chunking_strategy", "auto"},
	})
	resp, body, _ := gw.do(t, "/v1/audio/transcriptions", contentType, buf)
	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
	t.Logf("diarized_json body: %s", body)

	segments := gjson.GetBytes(body, "segments").Array()
	require.NotEmpty(t, segments, "a diarized transcript carries segments")
	for _, key := range []string{"speaker", "start", "end", "text"} {
		assert.True(t, segments[0].Get(key).Exists(), "segment field %q", key)
	}
	assert.Contains(t, strings.ToLower(gjson.GetBytes(body, "text").String()), "speaker labels")
	assert.NotContains(t, string(body), "extra_fields")
	assert.Empty(t, resp.Header.Get("Openai-Organization"))

	gw.settledOutcomes(t, 2)
}

// settledOutcomes waits until every request in the test has settled.
func (g *liveAudioGateway) settledOutcomes(t *testing.T, want int) {
	t.Helper()
	require.Eventually(t, func() bool {
		confirms, fails := g.spend.outcomes()
		return len(confirms)+len(fails) >= want
	}, 5*time.Second, 20*time.Millisecond)
	confirms, fails := g.spend.outcomes()
	assert.Empty(t, fails)
	for i := range confirms {
		t.Logf("spend: model=%s usage=%+v", confirms[i].Model, confirms[i].Usage)
	}
}

// @scenario "A long recording is diarized with a chunking strategy and known speakers"
func TestLiveAudio_DiarizedLongClipWithKnownSpeakers(t *testing.T) {
	gw := newLiveAudioGateway(t, "OPENAI_API_KEY")
	agentRef := gw.speakWAV(t, "alloy", "Good morning, you have reached the support desk, how can I help you today?")
	callerRef := gw.speakWAV(t, "onyx", "Hi, I am calling because my order has not arrived yet and I would like an update.")
	long := gw.speakWAV(t, "alloy", strings.Repeat(
		"Thank you for waiting while I look into this for you. I can see the order left the warehouse on Monday. ", 6))
	require.Greater(t, len(long), 30*48000, "the recording must be longer than thirty seconds of 24 kHz PCM16")

	dataURL := func(wav []byte) string { return "data:audio/wav;base64," + base64.StdEncoding.EncodeToString(wav) }
	buf := &bytes.Buffer{}
	contentType := writeTranscriptionForm(t, buf, long, [][2]string{
		{"model", "openai/gpt-4o-transcribe-diarize"},
		{"response_format", "diarized_json"},
		{"chunking_strategy", "auto"},
		{"known_speaker_names[]", "agent"},
		{"known_speaker_names[]", "caller"},
		{"known_speaker_references[]", dataURL(agentRef)},
		{"known_speaker_references[]", dataURL(callerRef)},
	})
	resp, body, _ := gw.do(t, "/v1/audio/transcriptions", contentType, buf)
	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))

	segments := gjson.GetBytes(body, "segments").Array()
	require.NotEmpty(t, segments)
	speakers := map[string]int{}
	for _, s := range segments {
		speakers[s.Get("speaker").String()]++
	}
	t.Logf("%d segments, speakers %v, duration %v", len(segments), speakers, gjson.GetBytes(body, "duration").Float())
	assert.Positive(t, speakers["agent"], "the known speaker name labels the voice it was given a reference for")
	assert.NotContains(t, string(body), "extra_fields")
}

// @scenario "Speech and transcription stream against the real provider"
func TestLiveAudio_StreamingSpeechAndTranscription(t *testing.T) {
	gw := newLiveAudioGateway(t, "OPENAI_API_KEY")
	clip := gw.speakWAV(t, "alloy", liveShortLine)

	resp, events, ttfb := gw.do(t, "/v1/audio/speech", "application/json", strings.NewReader(
		`{"model":"openai/gpt-4o-mini-tts","voice":"alloy","input":"Hello.","stream_format":"sse"}`))
	require.Equal(t, http.StatusOK, resp.StatusCode, string(events[:min(len(events), 400)]))
	assert.True(t, strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream"))
	assert.Contains(t, string(events), `"speech.audio.delta"`)
	assert.Contains(t, string(events), `"speech.audio.done"`)
	t.Logf("speech sse: first byte after %v, final event %s", ttfb, events[bytes.LastIndex(events, []byte("data: ")):])

	buf := &bytes.Buffer{}
	contentType := writeTranscriptionForm(t, buf, clip, [][2]string{
		{"model", "openai/gpt-transcribe"}, {"stream", "true"},
	})
	resp, events, ttfb = gw.do(t, "/v1/audio/transcriptions", contentType, buf)
	require.Equal(t, http.StatusOK, resp.StatusCode, string(events))
	assert.True(t, strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream"))
	assert.Contains(t, string(events), `"transcript.text.done"`)
	t.Logf("transcription sse: first byte after %v, final event %s", ttfb, events[bytes.LastIndex(events, []byte("data: ")):])

	gw.settledOutcomes(t, 3)
}

// @scenario "ElevenLabs synthesis streams against the real vendor"
func TestLiveAudio_ElevenLabsStream(t *testing.T) {
	gw := newLiveAudioGateway(t, "ELEVENLABS_API_KEY")
	// A premade voice every ElevenLabs account can use.
	const voice = "cjVigY5qzO86Huf0OWal"
	for _, model := range []string{"eleven_flash_v2_5", "eleven_v4"} {
		for _, suffix := range []string{"/stream", "/stream/with-timestamps"} {
			req, err := http.NewRequest(http.MethodPost, gw.url+"/v1/text-to-speech/"+voice+suffix,
				strings.NewReader(`{"text":"Hello from the gateway.","model_id":"`+model+`"}`))
			require.NoError(t, err)
			req.Header.Set("xi-api-key", "vk-lw-test")
			req.Header.Set("Content-Type", "application/json")
			start := time.Now()
			resp, err := http.DefaultClient.Do(req)
			require.NoError(t, err)
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			t.Logf("%s %s: HTTP %d, %s, %d bytes in %v: %s", model, suffix, resp.StatusCode,
				resp.Header.Get("Content-Type"), len(body), time.Since(start), printable(body))
			if model == "eleven_flash_v2_5" {
				assert.Equal(t, http.StatusOK, resp.StatusCode)
			}
		}
	}
}

// printable shows the head of a body when it is text, and nothing of audio.
func printable(body []byte) string {
	head := body[:min(len(body), 300)]
	for _, b := range head {
		if b < 0x09 || b > 0x7e {
			return "(binary)"
		}
	}
	return string(head)
}

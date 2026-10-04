package httpapi

// The streamed audio routes end to end: a real HTTP server in front of the
// router, the real provider dispatch behind it, and a local stand-in for the
// vendor. Covers what the caller receives and when, the spend outcome, and
// what the span holds.
//
// Binds specs/ai-gateway/audio-endpoints.feature.

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/providers"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// spendLedger records every spend outcome the pipeline emits.
type spendLedger struct {
	mu       sync.Mutex
	admitted int
	confirms []pipeline.SpendOutcome
	fails    []pipeline.SpendOutcome
}

func (l *spendLedger) AdmitSpend(pipeline.SpendAdmission) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.admitted++
}

func (l *spendLedger) ConfirmSpend(o pipeline.SpendOutcome) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.confirms = append(l.confirms, o)
}

func (l *spendLedger) FailSpend(o pipeline.SpendOutcome) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fails = append(l.fails, o)
}

func (l *spendLedger) outcomes() (confirms, fails []pipeline.SpendOutcome) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]pipeline.SpendOutcome(nil), l.confirms...), append([]pipeline.SpendOutcome(nil), l.fails...)
}

// settled waits for the one outcome a request owes, then checks no second
// one follows it.
func (l *spendLedger) settled(t *testing.T) (confirms, fails []pipeline.SpendOutcome) {
	t.Helper()
	require.Eventually(t, func() bool {
		c, f := l.outcomes()
		return len(c)+len(f) >= 1
	}, 3*time.Second, 5*time.Millisecond, "the request never settled its spend")
	time.Sleep(30 * time.Millisecond)
	confirms, fails = l.outcomes()
	require.Len(t, append(confirms, fails...), 1, "a request settles its spend exactly once")
	return confirms, fails
}

// spanLog records the spans the trace interceptor closes.
type spanLog struct {
	mu    sync.Mutex
	spans []domain.AITraceParams
}

func (s *spanLog) BeginSpan(ctx context.Context, _ string, _ domain.RequestType) (context.Context, string) {
	return ctx, "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"
}

func (s *spanLog) EndSpan(_ context.Context, params domain.AITraceParams) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.spans = append(s.spans, params)
}

func (s *spanLog) only(t *testing.T) domain.AITraceParams {
	t.Helper()
	require.Eventually(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return len(s.spans) >= 1
	}, 3*time.Second, 5*time.Millisecond, "the span never closed")
	s.mu.Lock()
	defer s.mu.Unlock()
	require.Len(t, s.spans, 1)
	return s.spans[0]
}

type audioGateway struct {
	url   string
	spend *spendLedger
	spans *spanLog
}

// newAudioGateway serves the router over a real socket, with the real
// provider dispatch pointed at vendor for both OpenAI and ElevenLabs.
func newAudioGateway(t *testing.T, vendor *httptest.Server) *audioGateway {
	t.Helper()
	bf, err := providers.NewBifrostRouter(context.Background(), providers.BifrostOptions{
		Logger:           zap.NewNop(),
		OpenAIBackendURL: vendor.URL,
	})
	require.NoError(t, err)
	t.Cleanup(bf.Close)

	gw := &audioGateway{spend: &spendLedger{}, spans: &spanLog{}}
	router := buildRouter(
		app.WithAuth(audioAuth(
			domain.Credential{
				ID: "cred-11labs", ProviderID: domain.ProviderElevenLabs, APIKey: "xi-test",
				Extra: map[string]string{"base_url": vendor.URL},
			},
			domain.Credential{ID: "cred-gemini", ProviderID: domain.ProviderGemini, APIKey: "goog-test"},
		)),
		app.WithProviders(bf),
		app.WithModels(modelresolver.New()),
		app.WithSpend(gw.spend),
		app.WithTraces(gw.spans),
		app.WithLogger(zap.NewNop()),
	)
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	gw.url = server.URL
	return gw
}

func (g *audioGateway) post(ctx context.Context, t *testing.T, path, contentType string, body io.Reader) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.url+path, body)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

// gatedVendor writes each chunk, flushes it, and waits for the test to ask
// for the next one.
func gatedVendor(contentType string, chunks []string, produced *atomic.Int32, next <-chan struct{}) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", contentType)
		flusher, _ := w.(http.Flusher)
		for i, chunk := range chunks {
			_, _ = w.Write([]byte(chunk))
			flusher.Flush()
			produced.Add(1)
			if i == len(chunks)-1 {
				return
			}
			select {
			case <-next:
			case <-r.Context().Done():
				return
			}
		}
	}))
}

const speechStreamBody = `{"model":"openai/gpt-4o-mini-tts","voice":"alloy","input":"Read this sentence aloud."}`

// @scenario "Synthesized speech is relayed as the provider produces it"
func TestAudioSpeechStream_CallerHearsTheFirstChunkBeforeTheLastIsProduced(t *testing.T) {
	chunks := []string{"chunk-1|", "chunk-2|", "chunk-3|", "chunk-4|", "chunk-5|"}
	var produced atomic.Int32
	next := make(chan struct{})
	vendor := gatedVendor("audio/mpeg", chunks, &produced, next)
	defer vendor.Close()
	gw := newAudioGateway(t, vendor)

	resp := gw.post(context.Background(), t, "/v1/audio/speech", "application/json", strings.NewReader(speechStreamBody))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "audio/mpeg", resp.Header.Get("Content-Type"))
	assert.NotEmpty(t, resp.Header.Get("X-LangWatch-Gateway-Request-Id"))

	buf := make([]byte, len(chunks[0]))
	for i, want := range chunks {
		_, err := io.ReadFull(resp.Body, buf)
		require.NoError(t, err)
		assert.Equal(t, want, string(buf))
		assert.Equal(t, int32(i+1), produced.Load(),
			"chunk %d reached the caller while the provider had produced only %d", i+1, i+1)
		if i < len(chunks)-1 {
			next <- struct{}{}
		}
	}
	rest, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Empty(t, rest)

	confirms, _ := gw.spend.settled(t)
	require.Len(t, confirms, 1)
	assert.Equal(t, 25, confirms[0].Usage.InputChars)

	span := gw.spans.only(t)
	assert.Contains(t, string(span.RequestBody), "Read this sentence aloud.", "the span holds the text that was spoken")
	assert.Empty(t, span.ResponseBody, "audio bytes never reach the span")
	assert.Zero(t, span.UpstreamStatusCode)
	assert.Equal(t, 25, span.Usage.InputChars)
}

// @scenario "A character-priced voice is charged when the caller disconnects mid-stream"
func TestAudioSpeechStream_CallerDisconnectStillChargesTheCharacters(t *testing.T) {
	var produced atomic.Int32
	next := make(chan struct{})
	vendor := gatedVendor("audio/mpeg", []string{"chunk-1|", "chunk-2|"}, &produced, next)
	defer vendor.Close()
	gw := newAudioGateway(t, vendor)

	ctx, hangUp := context.WithCancel(context.Background())
	defer hangUp()
	resp := gw.post(ctx, t, "/v1/audio/speech", "application/json", strings.NewReader(speechStreamBody))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	buf := make([]byte, len("chunk-1|"))
	_, err := io.ReadFull(resp.Body, buf)
	require.NoError(t, err)
	hangUp()

	_, fails := gw.spend.settled(t)
	require.Len(t, fails, 1, "a hung-up stream is a failed outcome, and it still carries what was dispatched")
	assert.Equal(t, 25, fails[0].Usage.InputChars)

	span := gw.spans.only(t)
	assert.NotEmpty(t, span.UpstreamErrorType, "the span is marked as cut, the way a cut chat stream is")
	assert.Equal(t, 25, span.Usage.InputChars)
	assert.Empty(t, span.ResponseBody)
}

// @scenario "Speech events are relayed unchanged and the final event states the usage"
func TestAudioSpeechStream_EventsCarryTheUsage(t *testing.T) {
	const events = `data: {"type":"speech.audio.delta","audio":"AAAA"}` + "\n\n" +
		`data: {"type":"speech.audio.done","usage":{"input_tokens":14,"output_tokens":101,"total_tokens":115}}` + "\n\n"
	var gotBody []byte
	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(events))
	}))
	defer vendor.Close()
	gw := newAudioGateway(t, vendor)

	body := `{"model":"openai/gpt-4o-mini-tts","voice":"alloy","input":"Hello","stream_format":"sse"}`
	resp := gw.post(context.Background(), t, "/v1/audio/speech", "application/json", strings.NewReader(body))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
	got, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Equal(t, events, string(got))
	assert.Contains(t, string(gotBody), `"stream_format":"sse"`)
	assert.Equal(t, "gpt-4o-mini-tts", gjson.GetBytes(gotBody, "model").String(),
		"the provider is sent the model it knows, without the gateway's provider prefix")

	confirms, _ := gw.spend.settled(t)
	require.Len(t, confirms, 1)
	assert.Equal(t, 14, confirms[0].Usage.PromptTokens)
	assert.Equal(t, 101, confirms[0].Usage.CompletionTokens)
	assert.Equal(t, 5, confirms[0].Usage.InputChars)
	assert.Empty(t, gw.spans.only(t).ResponseBody, "base64 audio inside an event is still audio")
}

// @scenario "A speech stream cut before its final event is charged by characters"
func TestAudioSpeechStream_ProviderCutFallsBackToCharacters(t *testing.T) {
	const delta = `data: {"type":"speech.audio.delta","audio":"AAAA"}` + "\n\n"
	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(delta))
	}))
	defer vendor.Close()
	gw := newAudioGateway(t, vendor)

	body := `{"model":"openai/gpt-4o-mini-tts","voice":"alloy","input":"Hello","stream_format":"sse"}`
	resp := gw.post(context.Background(), t, "/v1/audio/speech", "application/json", strings.NewReader(body))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	got, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(string(got), delta), "what the provider sent is relayed first")
	assert.Contains(t, string(got[len(delta):]), "event: error", "the caller is told the stream did not finish")

	_, fails := gw.spend.settled(t)
	require.Len(t, fails, 1)
	assert.Equal(t, domain.Usage{InputChars: 5}, fails[0].Usage)

	span := gw.spans.only(t)
	assert.Equal(t, http.StatusBadGateway, span.UpstreamStatusCode)
	assert.Equal(t, "provider_error", span.UpstreamErrorType)
}

// @scenario "A streamed transcription relays the provider's events unchanged"
func TestAudioTranscriptionStream_RelaysEventsAndCapturesTheTranscript(t *testing.T) {
	const events = `data: {"type":"transcript.text.delta","delta":"Hello"}` + "\n\n" +
		`data: {"type":"transcript.text.delta","delta":" there"}` + "\n\n" +
		`data: {"type":"transcript.text.done","text":"Hello there","usage":{"type":"tokens","input_tokens":40,"output_tokens":6,"total_tokens":46}}` + "\n\n"
	var form map[string][]string
	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/audio/transcriptions", r.URL.Path)
		form = textParts(t, r)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(events))
	}))
	defer vendor.Close()
	gw := newAudioGateway(t, vendor)

	audio := []byte("RIFF-not-really-audio")
	buf := &bytes.Buffer{}
	contentType := writeTranscriptionForm(t, buf, audio, [][2]string{
		{"model", "openai/gpt-4o-transcribe"},
		{"stream", "true"},
		{"chunking_strategy", "auto"},
		{"include[]", "logprobs"},
		{"timestamp_granularities[]", "word"},
		{"timestamp_granularities[]", "segment"},
		{"an_option_added_next_year", "kept"},
	})
	resp := gw.post(context.Background(), t, "/v1/audio/transcriptions", contentType, buf)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
	got, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Equal(t, events, string(got), "the events reach the caller byte for byte")

	assert.Equal(t, []string{"gpt-4o-transcribe"}, form["model"])
	assert.Equal(t, []string{"true"}, form["stream"])
	assert.Equal(t, []string{"auto"}, form["chunking_strategy"])
	assert.Equal(t, []string{"logprobs"}, form["include[]"])
	assert.Equal(t, []string{"word", "segment"}, form["timestamp_granularities[]"])
	assert.Equal(t, []string{"kept"}, form["an_option_added_next_year"])

	confirms, _ := gw.spend.settled(t)
	require.Len(t, confirms, 1)
	assert.Equal(t, 46, confirms[0].Usage.TotalTokens)

	span := gw.spans.only(t)
	assert.Contains(t, string(span.ResponseBody), "Hello there", "the span holds the transcript")
	assert.NotContains(t, string(span.RequestBody), "RIFF-not-really-audio", "the uploaded audio never reaches the span")
}

// @scenario "Streaming a transcription on a provider that cannot stream is refused"
func TestAudioStream_RefusedWhereTheProviderCannotStream(t *testing.T) {
	var vendorCalls atomic.Int32
	vendor := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { vendorCalls.Add(1) }))
	defer vendor.Close()
	gw := newAudioGateway(t, vendor)

	buf := &bytes.Buffer{}
	contentType := writeTranscriptionForm(t, buf, []byte("audio"), [][2]string{
		{"model", "gemini/gemini-2.5-flash"}, {"stream", "true"},
	})
	resp := gw.post(context.Background(), t, "/v1/audio/transcriptions", contentType, buf)
	body, _ := io.ReadAll(resp.Body)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	assert.Contains(t, string(body), "unsupported_parameter")
	assert.Contains(t, string(body), "without stream")

	resp = gw.post(context.Background(), t, "/v1/audio/speech", "application/json", strings.NewReader(
		`{"model":"elevenlabs/eleven_flash_v2_5","voice":"voice_1","input":"Hi","stream_format":"sse"}`))
	body, _ = io.ReadAll(resp.Body)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	assert.Contains(t, string(body), "unsupported_parameter")
	assert.Zero(t, vendorCalls.Load(), "a refused request reaches no provider")
}

// @scenario "A provider refusal on a streamed audio route reaches the caller in the provider's words"
func TestAudioSpeechStream_ProviderRefusalKeepsItsStatusAndBody(t *testing.T) {
	const refusal = `{"error":{"message":"stream_format sse is not supported for tts-1","type":"invalid_request_error","code":"unsupported_value"}}`
	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(refusal))
	}))
	defer vendor.Close()
	gw := newAudioGateway(t, vendor)

	resp := gw.post(context.Background(), t, "/v1/audio/speech", "application/json", strings.NewReader(
		`{"model":"openai/tts-1","voice":"alloy","input":"Hello","stream_format":"sse"}`))
	body, _ := io.ReadAll(resp.Body)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	assert.Contains(t, string(body), "stream_format sse is not supported for tts-1")

	_, fails := gw.spend.settled(t)
	require.Len(t, fails, 1)
	assert.Zero(t, fails[0].Usage.InputChars, "a refused synthesis charges nothing")
}

// @scenario "ElevenLabs' streaming synthesis paths reach the vendor unchanged"
func TestElevenLabsNativeSpeechStream_RoutesReachTheirVendorPath(t *testing.T) {
	cases := map[string]struct {
		suffix      string
		contentType string
		chunks      []string
	}{
		"stream":                 {"/stream", "audio/mpeg", []string{"ID3-one|", "ID3-two|"}},
		"stream with timestamps": {"/stream/with-timestamps", "application/json", []string{`{"audio_base64":"AAAA"}` + "\n", `{"audio_base64":"BBBB"}` + "\n"}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			var produced atomic.Int32
			next := make(chan struct{})
			var gotPath, gotQuery, gotKey string
			var gotBody []byte
			vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath, gotQuery, gotKey = r.URL.Path, r.URL.RawQuery, r.Header.Get("xi-api-key")
				gotBody, _ = io.ReadAll(r.Body)
				w.Header().Set("Content-Type", tc.contentType)
				flusher, _ := w.(http.Flusher)
				_, _ = w.Write([]byte(tc.chunks[0]))
				flusher.Flush()
				produced.Add(1)
				select {
				case <-next:
				case <-r.Context().Done():
					return
				}
				_, _ = w.Write([]byte(tc.chunks[1]))
				produced.Add(1)
			}))
			defer vendor.Close()
			gw := newAudioGateway(t, vendor)

			req, err := http.NewRequest(http.MethodPost,
				gw.url+"/v1/text-to-speech/voice_1"+tc.suffix+"?output_format=mp3_22050_32&optimize_streaming_latency=3",
				strings.NewReader(`{"text":"Hello","model_id":"elevenlabs/eleven_flash_v2_5"}`))
			require.NoError(t, err)
			req.Header.Set("xi-api-key", "vk-lw-test")
			resp, err := http.DefaultClient.Do(req)
			require.NoError(t, err)
			defer func() { _ = resp.Body.Close() }()
			require.Equal(t, http.StatusOK, resp.StatusCode)
			assert.Equal(t, tc.contentType, resp.Header.Get("Content-Type"))

			first := make([]byte, len(tc.chunks[0]))
			_, err = io.ReadFull(resp.Body, first)
			require.NoError(t, err)
			assert.Equal(t, tc.chunks[0], string(first))
			assert.Equal(t, int32(1), produced.Load(), "the first chunk is relayed before the second exists")
			next <- struct{}{}
			rest, err := io.ReadAll(resp.Body)
			require.NoError(t, err)
			assert.Equal(t, tc.chunks[1], string(rest))

			assert.Equal(t, "/v1/text-to-speech/voice_1"+tc.suffix, gotPath)
			assert.Equal(t, "output_format=mp3_22050_32&optimize_streaming_latency=3", gotQuery)
			assert.Equal(t, "xi-test", gotKey, "the vendor sees the provider key, never the virtual key")
			assert.JSONEq(t, `{"text":"Hello","model_id":"eleven_flash_v2_5"}`, string(gotBody))

			confirms, _ := gw.spend.settled(t)
			require.Len(t, confirms, 1)
			assert.Equal(t, 5, confirms[0].Usage.InputChars)
			assert.Equal(t, "eleven_flash_v2_5", confirms[0].Model)
		})
	}
}

// @scenario "The streaming ElevenLabs routes honor the virtual key's model allowlist"
func TestElevenLabsNativeSpeechStream_AllowlistApplies(t *testing.T) {
	var vendorCalls atomic.Int32
	vendor := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { vendorCalls.Add(1) }))
	defer vendor.Close()

	bf, err := providers.NewBifrostRouter(context.Background(), providers.BifrostOptions{Logger: zap.NewNop()})
	require.NoError(t, err)
	t.Cleanup(bf.Close)
	auth := &mockAuth{resolveFn: func(context.Context, string) (*domain.Bundle, error) {
		b := testBundle()
		b.Credentials = append(b.Credentials, domain.Credential{
			ID: "cred-11labs", ProviderID: domain.ProviderElevenLabs, APIKey: "xi-test",
			Extra: map[string]string{"base_url": vendor.URL},
		})
		b.Config.AllowedModels = []string{"eleven_flash_v2_5"}
		return b, nil
	}}
	router := buildRouter(app.WithAuth(auth), app.WithProviders(bf),
		app.WithModels(modelresolver.New()), app.WithLogger(zap.NewNop()))

	for _, suffix := range []string{"/stream", "/stream/with-timestamps"} {
		req := httptest.NewRequest(http.MethodPost, "/v1/text-to-speech/voice_1"+suffix,
			strings.NewReader(`{"text":"Hello","model_id":"eleven_multilingual_v2"}`))
		req.Header.Set("xi-api-key", "vk-lw-test")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code, suffix)
		assert.Contains(t, rec.Body.String(), "model_not_allowed", suffix)
	}
	assert.Zero(t, vendorCalls.Load())
}

// diarizedTranscript is the body OpenAI answers response_format
// "diarized_json" with: segments that carry a speaker, a start and an end.
const diarizedTranscript = `{"task":"transcribe","duration":3.5,"text":"Hello there. This is a short test of speaker labels.",` +
	`"segments":[{"type":"transcript.text.segment","id":"seg_0","speaker":"A","start":0.0,"end":1.1,"text":"Hello there."},` +
	`{"type":"transcript.text.segment","id":"seg_1","speaker":"A","start":1.3,"end":3.5,"text":"This is a short test of speaker labels."}],` +
	`"usage":{"type":"tokens","input_tokens":35,"output_tokens":21,"total_tokens":56}}`

// @scenario "A diarized transcription returns the provider's segments unchanged"
func TestAudioTranscriptions_DiarizedBodyIsRelayedUnchanged(t *testing.T) {
	var sent []formPart
	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sent = orderedTextParts(t, r)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Openai-Organization", "acme-internal")
		_, _ = w.Write([]byte(diarizedTranscript))
	}))
	defer vendor.Close()
	gw := newAudioGateway(t, vendor)

	fields := [][2]string{
		{"model", "openai/gpt-4o-transcribe-diarize"},
		{"response_format", "diarized_json"},
		{"chunking_strategy", "auto"},
		{"known_speaker_names[]", "agent"},
		{"known_speaker_names[]", "caller"},
		{"known_speaker_references[]", "data:audio/wav;base64,QUdFTlQ="},
		{"known_speaker_references[]", "data:audio/wav;base64,Q0FMTEVS"},
	}
	buf := &bytes.Buffer{}
	contentType := writeTranscriptionForm(t, buf, []byte("RIFF-not-really-audio"), fields)
	resp := gw.post(context.Background(), t, "/v1/audio/transcriptions", contentType, buf)
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
	assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))
	assert.True(t, bytes.Equal([]byte(diarizedTranscript), body),
		"segments, speakers and timings reach the caller byte for byte, got %s", body)
	assert.NotContains(t, string(body), "extra_fields")
	assert.Empty(t, resp.Header.Get("Openai-Organization"), "the provider account name is not passed on")

	want := []formPart{{"model", "gpt-4o-transcribe-diarize"}}
	for _, f := range fields[1:] {
		want = append(want, formPart{f[0], f[1]})
	}
	assert.Equal(t, want, sent, "every part reaches the provider in the caller's order, with the resolved model first")

	confirms, _ := gw.spend.settled(t)
	require.Len(t, confirms, 1)
	assert.Equal(t, 56, confirms[0].Usage.TotalTokens)
	assert.Contains(t, string(gw.spans.only(t).ResponseBody), "speaker labels", "the span holds the transcript")
}

// @scenario "A transcript comes back in the response format the caller asked for"
func TestAudioTranscriptions_PlainTextFormatsKeepTheirBodyAndContentType(t *testing.T) {
	cases := map[string]struct{ contentType, body string }{
		"text": {"text/plain; charset=utf-8", "Hello there.\n"},
		"srt":  {"text/plain; charset=utf-8", "1\n00:00:00,000 --> 00:00:02,000\nHello there.\n\n"},
		"vtt":  {"text/vtt; charset=utf-8", "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello there.\n\n"},
	}
	for format, tc := range cases {
		t.Run(format, func(t *testing.T) {
			vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				w.Header().Set("Content-Type", tc.contentType)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer vendor.Close()
			gw := newAudioGateway(t, vendor)

			buf := &bytes.Buffer{}
			contentType := writeTranscriptionForm(t, buf, []byte("unreadable-container-of-16000-bytes"), [][2]string{
				{"model", "openai/gpt-transcribe"}, {"response_format", format},
			})
			resp := gw.post(context.Background(), t, "/v1/audio/transcriptions", contentType, buf)
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
			assert.Equal(t, tc.contentType, resp.Header.Get("Content-Type"))
			assert.Equal(t, tc.body, string(body), "no JSON envelope around a transcript that is not JSON")

			confirms, _ := gw.spend.settled(t)
			require.Len(t, confirms, 1)
			assert.Positive(t, confirms[0].Usage.AudioSeconds,
				"a body that states no usage is charged the duration of the uploaded audio")
		})
	}
}

type formPart struct{ name, value string }

// orderedTextParts reads the text parts the gateway posted to the stand-in
// provider, in the order they were written.
func orderedTextParts(t *testing.T, r *http.Request) []formPart {
	t.Helper()
	reader, err := r.MultipartReader()
	if err != nil {
		t.Errorf("the provider received a body that is not multipart: %v", err)
		return nil
	}
	var parts []formPart
	for {
		p, err := reader.NextPart()
		if err != nil {
			return parts
		}
		data, _ := io.ReadAll(p)
		if p.FileName() == "" {
			parts = append(parts, formPart{p.FormName(), string(data)})
		}
	}
}

// textParts is orderedTextParts keyed by part name.
func textParts(t *testing.T, r *http.Request) map[string][]string {
	t.Helper()
	form := map[string][]string{}
	for _, p := range orderedTextParts(t, r) {
		form[p.name] = append(form[p.name], p.value)
	}
	return form
}

func writeTranscriptionForm(t *testing.T, buf *bytes.Buffer, audio []byte, fields [][2]string) string {
	t.Helper()
	const boundary = "audio-stream-test-boundary"
	w := bufio.NewWriter(buf)
	for _, field := range fields {
		_, _ = w.WriteString("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + field[0] + "\"\r\n\r\n" + field[1] + "\r\n")
	}
	_, _ = w.WriteString("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.wav\"\r\n" +
		"Content-Type: audio/wav\r\n\r\n")
	_, _ = w.Write(audio)
	_, _ = w.WriteString("\r\n--" + boundary + "--\r\n")
	require.NoError(t, w.Flush())
	return "multipart/form-data; boundary=" + boundary
}

// TestAudioSpeechStream_FirstByteOverhead measures what the gateway adds to
// the time a caller waits for the first audio byte: the same local vendor
// dialed directly and through the gateway, over real sockets, alternating.
//
// @scenario "The gateway adds under 20 ms to the first audio byte"
func TestAudioSpeechStream_FirstByteOverhead(t *testing.T) {
	if testing.Short() {
		t.Skip("latency measurement")
	}
	const rounds = 300
	first := bytes.Repeat([]byte{0x55}, 4096)
	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(first)
		w.(http.Flusher).Flush()
		// The rest of the audio is still being synthesized.
		time.Sleep(5 * time.Millisecond)
		_, _ = w.Write(first)
	}))
	defer vendor.Close()
	gw := newAudioGateway(t, vendor)

	firstByte := func(url string) time.Duration {
		req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(speechStreamBody))
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer vk-lw-test")
		req.Header.Set("Content-Type", "application/json")
		start := time.Now()
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer func() { _ = resp.Body.Close() }()
		one := make([]byte, 1)
		_, err = io.ReadFull(resp.Body, one)
		elapsed := time.Since(start)
		require.NoError(t, err)
		_, _ = io.Copy(io.Discard, resp.Body)
		return elapsed
	}

	direct, through := make([]time.Duration, 0, rounds), make([]time.Duration, 0, rounds)
	for i := 0; i < rounds+20; i++ {
		d, g := firstByte(vendor.URL+"/v1/audio/speech"), firstByte(gw.url+"/v1/audio/speech")
		if i >= 20 { // warm connections first
			direct, through = append(direct, d), append(through, g)
		}
	}
	percentile := func(samples []time.Duration, p float64) time.Duration {
		sorted := append([]time.Duration(nil), samples...)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
		return sorted[int(float64(len(sorted)-1)*p)]
	}
	overhead := percentile(through, 0.5) - percentile(direct, 0.5)
	t.Logf("first audio byte over %d rounds: direct p50=%v p95=%v, through the gateway p50=%v p95=%v, overhead p50=%v p95=%v",
		rounds, percentile(direct, 0.5), percentile(direct, 0.95), percentile(through, 0.5), percentile(through, 0.95),
		overhead, percentile(through, 0.95)-percentile(direct, 0.95))
	assert.Less(t, overhead, 20*time.Millisecond)
}

package providers

// The streamed audio dispatch: provider bytes relayed as they arrive, the
// usage read off the final event, and the charge when that event never comes.
//
// Binds specs/ai-gateway/audio-endpoints.feature.

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func openAIAudioRouter(server *httptest.Server) *BifrostRouter {
	return &BifrostRouter{elevenLabsClient: server.Client(), openAIBaseURL: server.URL}
}

func openAIAudioCredential() domain.Credential {
	return domain.Credential{ID: "openai_1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-secret"}
}

func speechRequest(body string) *domain.Request {
	return &domain.Request{Type: domain.RequestTypeSpeech, Model: "gpt-4o-mini-tts", Body: []byte(body)}
}

// gatedChunks writes each chunk, flushes it, and waits for the test to ask
// for the next one, so a test can prove where the bytes are at each step.
func gatedChunks(
	w http.ResponseWriter, r *http.Request, chunks []string, produced *atomic.Int32, next <-chan struct{},
) {
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
}

// wavFile builds a 16 kHz mono 16-bit PCM file of the given length.
func wavFile(seconds int) []byte {
	const byteRate = 32000
	data := make([]byte, seconds*byteRate)
	var b bytes.Buffer
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(36+len(data)))
	b.WriteString("WAVEfmt ")
	_ = binary.Write(&b, binary.LittleEndian, uint32(16))
	_ = binary.Write(&b, binary.LittleEndian, uint16(1))
	_ = binary.Write(&b, binary.LittleEndian, uint16(1))
	_ = binary.Write(&b, binary.LittleEndian, uint32(16000))
	_ = binary.Write(&b, binary.LittleEndian, uint32(byteRate))
	_ = binary.Write(&b, binary.LittleEndian, uint16(2))
	_ = binary.Write(&b, binary.LittleEndian, uint16(16))
	b.WriteString("data")
	_ = binary.Write(&b, binary.LittleEndian, uint32(len(data)))
	b.Write(data)
	return b.Bytes()
}

// @scenario "Synthesized speech is relayed as the provider produces it"
func TestSpeechStreamDeliversTheFirstChunkBeforeTheLastIsProduced(t *testing.T) {
	t.Parallel()

	chunks := []string{"chunk-1|", "chunk-2|", "chunk-3|", "chunk-4|", "chunk-5|"}
	var produced atomic.Int32
	next := make(chan struct{})
	var gotAuth, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		gotAuth, gotBody = r.Header.Get("Authorization"), string(raw)
		assert.Equal(t, "/v1/audio/speech", r.URL.Path)
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Header().Set("X-Request-Id", "req_speech_1")
		gatedChunks(w, r, chunks, &produced, next)
	}))
	defer server.Close()

	body := `{"model":"gpt-4o-mini-tts","voice":"alloy","input":"Olá, mundo","stream_format":"audio"}`
	iter, err := speechStream(openAIAudioRouter(server), speechRequest(body), "gpt-4o-mini-tts", openAIAudioCredential())
	require.NoError(t, err)
	defer func() { _ = iter.Close() }()

	for i, want := range chunks {
		require.True(t, iter.Next(context.Background()), "chunk %d", i+1)
		assert.Equal(t, want, string(iter.Chunk()))
		assert.Equal(t, int32(i+1), produced.Load(),
			"chunk %d reached the caller while the provider had produced only %d", i+1, i+1)
		if i < len(chunks)-1 {
			next <- struct{}{}
		}
	}
	assert.False(t, iter.Next(context.Background()))
	require.NoError(t, iter.Err())

	assert.Equal(t, "Bearer sk-secret", gotAuth)
	assert.JSONEq(t, body, gotBody, "stream_format reaches the provider with the rest of the body")
	headers := domain.StreamHeadersOf(iter)
	assert.Equal(t, "audio/mpeg", headers["Content-Type"])
	assert.Equal(t, "req_speech_1", headers["X-Request-Id"])
	assert.Equal(t, domain.Usage{InputChars: 10}, iter.Usage(),
		"raw audio states no usage, so the charge is the ten runes of the input")
}

const speechEvents = `data: {"type":"speech.audio.delta","audio":"AAAA"}

data: {"type":"speech.audio.delta","audio":"BBBB"}

data: {"type":"speech.audio.done","usage":{"input_tokens":14,"output_tokens":101,"total_tokens":115}}

`

// @scenario "Speech events are relayed unchanged and the final event states the usage"
func TestSpeechStreamReadsUsageFromTheFinalEvent(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		// Split inside the final event, so its usage spans two reads.
		cut := strings.Index(speechEvents, `"input_tokens"`)
		_, _ = w.Write([]byte(speechEvents[:cut]))
		flusher.Flush()
		_, _ = w.Write([]byte(speechEvents[cut:]))
	}))
	defer server.Close()

	iter, err := speechStream(openAIAudioRouter(server), speechRequest(`{"model":"gpt-4o-mini-tts","voice":"alloy","input":"Hello","stream_format":"sse"}`),
		"gpt-4o-mini-tts", openAIAudioCredential())
	require.NoError(t, err)

	resp, err := drainAudioStream(context.Background(), iter)
	require.NoError(t, err)
	assert.Equal(t, speechEvents, string(resp.Body), "the events reach the caller byte for byte")
	assert.Equal(t, domain.Usage{InputChars: 5, PromptTokens: 14, CompletionTokens: 101, TotalTokens: 115}, resp.Usage)
}

// @scenario "A speech stream cut before its final event is charged by characters"
func TestSpeechStreamCutBeforeTheFinalEventChargesCharacters(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"type":"speech.audio.delta","audio":"AAAA"}` + "\n\n"))
	}))
	defer server.Close()

	iter, err := speechStream(openAIAudioRouter(server), speechRequest(`{"model":"gpt-4o-mini-tts","voice":"alloy","input":"Hello","stream_format":"sse"}`),
		"gpt-4o-mini-tts", openAIAudioCredential())
	require.NoError(t, err)
	defer func() { _ = iter.Close() }()

	require.True(t, iter.Next(context.Background()))
	assert.False(t, iter.Next(context.Background()))

	var upstream *domain.UpstreamError
	require.ErrorAs(t, iter.Err(), &upstream, "a stream without its final event is a cut, not a clean end")
	assert.Equal(t, http.StatusBadGateway, upstream.StatusCode)
	assert.Equal(t, domain.Usage{InputChars: 5}, iter.Usage())
}

// @scenario "A character-priced voice is charged when the caller disconnects mid-stream"
func TestSpeechStreamChargesCharactersWhenTheCallerDisconnects(t *testing.T) {
	t.Parallel()

	var produced atomic.Int32
	next := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/mpeg")
		gatedChunks(w, r, []string{"chunk-1|", "chunk-2|"}, &produced, next)
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := &domain.Request{
		Type:       domain.RequestTypeSpeech,
		Body:       []byte(`{"text":"Bonjour à tous","model_id":"eleven_flash_v2_5"}`),
		ElevenLabs: &domain.ElevenLabsAudioRequest{VoiceID: "voice_1", Variant: domain.ElevenLabsSpeechStream},
	}
	iter, err := elevenLabsAudioRouter(server).dispatchElevenLabsSpeechStream(ctx, req, elevenLabsCredential(server))
	require.NoError(t, err)
	defer func() { _ = iter.Close() }()

	require.True(t, iter.Next(ctx))
	cancel()
	assert.False(t, iter.Next(ctx))

	require.ErrorIs(t, iter.Err(), context.Canceled)
	assert.Equal(t, domain.Usage{InputChars: 14}, iter.Usage(),
		"the vendor bills the text it accepted, whatever the caller heard of it")
}

// transcriptionRequest builds the upload the router hands over: every text
// part in order, and the first value of each under its bare name.
func transcriptionRequest(file []byte, fields ...domain.FormField) *domain.Request {
	params := map[string]string{}
	for _, f := range fields {
		if bare := strings.TrimSuffix(f.Name, "[]"); params[bare] == "" {
			params[bare] = f.Value
		}
	}
	return &domain.Request{
		Type:  domain.RequestTypeTranscription,
		Model: "gpt-4o-transcribe",
		Transcription: &domain.TranscriptionUpload{
			File: file, Filename: "meeting.wav", Params: params, Fields: fields,
		},
	}
}

func speechStream(r *BifrostRouter, req *domain.Request, model string, cred domain.Credential) (domain.StreamIterator, error) {
	return r.dispatchSpeechStream(context.Background(), audioCall{req: req, model: model, cred: cred})
}

func transcriptionStream(r *BifrostRouter, req *domain.Request, model string, cred domain.Credential) (domain.StreamIterator, error) {
	return r.dispatchTranscriptionStream(context.Background(), audioCall{req: req, model: model, cred: cred})
}

const transcriptEvents = `data: {"type":"transcript.text.delta","delta":"Hello"}

data: {"type":"transcript.text.delta","delta":" there"}

`

// @scenario "A streamed transcription relays the provider's events unchanged"
func TestTranscriptionStreamRelaysEventsAndForwardsTheParameters(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		done string
		want domain.Usage
	}{
		"token usage": {
			done: `{"type":"transcript.text.done","text":"Hello there","usage":{"type":"tokens","input_tokens":40,` +
				`"output_tokens":6,"total_tokens":46,"input_token_details":{"audio_tokens":30,"text_tokens":10}}}`,
			want: domain.Usage{PromptTokens: 40, CompletionTokens: 6, TotalTokens: 46}.
				SplitAudioTokens(domain.AudioTokenSplit{InputAudio: 30, InputText: 10}),
		},
		"duration usage": {
			done: `{"type":"transcript.text.done","text":"Hello there","usage":{"type":"duration","seconds":12.5}}`,
			want: domain.Usage{AudioSeconds: 12.5},
		},
		"no usage stated": {
			done: `{"type":"transcript.text.done","text":"Hello there"}`,
			want: domain.Usage{AudioSeconds: 2},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			events := transcriptEvents + "data: " + tc.done + "\n\n"
			var form map[string][]string
			var gotFile []byte
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/v1/audio/transcriptions", r.URL.Path)
				form, gotFile = readProviderForm(t, r)
				w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
				_, _ = w.Write([]byte(events))
			}))
			defer server.Close()

			audio := wavFile(2)
			req := transcriptionRequest(audio,
				domain.FormField{Name: "stream", Value: "true"},
				domain.FormField{Name: "chunking_strategy", Value: "auto"},
				domain.FormField{Name: "language", Value: "en"},
				domain.FormField{Name: "include[]", Value: "logprobs"},
				domain.FormField{Name: "timestamp_granularities[]", Value: "word"},
				domain.FormField{Name: "timestamp_granularities[]", Value: "segment"})
			iter, err := transcriptionStream(openAIAudioRouter(server), req, "gpt-4o-transcribe", openAIAudioCredential())
			require.NoError(t, err)

			resp, err := drainAudioStream(context.Background(), iter)
			require.NoError(t, err)
			assert.Equal(t, events, string(resp.Body), "the events reach the caller byte for byte")
			assert.Equal(t, tc.want, resp.Usage)

			assert.Equal(t, audio, gotFile)
			assert.Equal(t, []string{"gpt-4o-transcribe"}, form["model"])
			assert.Equal(t, []string{"true"}, form["stream"])
			assert.Equal(t, []string{"auto"}, form["chunking_strategy"])
			assert.Equal(t, []string{"en"}, form["language"])
			assert.Equal(t, []string{"logprobs"}, form["include[]"])
			assert.Equal(t, []string{"word", "segment"}, form["timestamp_granularities[]"])
		})
	}
}

// @scenario "A transcription stream cut before its final event is charged the uploaded duration"
func TestTranscriptionStreamCutChargesTheUploadedDuration(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(transcriptEvents))
	}))
	defer server.Close()

	req := transcriptionRequest(wavFile(3), domain.FormField{Name: "stream", Value: "true"})
	iter, err := transcriptionStream(openAIAudioRouter(server), req, "gpt-4o-transcribe", openAIAudioCredential())
	require.NoError(t, err)
	defer func() { _ = iter.Close() }()

	var relayed bytes.Buffer
	for iter.Next(context.Background()) {
		relayed.Write(iter.Chunk())
	}
	assert.Equal(t, transcriptEvents, relayed.String(), "what the provider did send still reaches the caller")
	require.Error(t, iter.Err())
	assert.Equal(t, domain.Usage{AudioSeconds: 3}, iter.Usage())
}

// @scenario "A model that ignores stream answers with one transcript body"
func TestTranscriptionStreamAcceptsAOneBodyAnswer(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"Hello there","usage":{"type":"duration","seconds":7}}`))
	}))
	defer server.Close()

	req := transcriptionRequest(wavFile(1), domain.FormField{Name: "stream", Value: "true"})
	iter, err := transcriptionStream(openAIAudioRouter(server), req, "whisper-1", openAIAudioCredential())
	require.NoError(t, err)

	resp, err := drainAudioStream(context.Background(), iter)
	require.NoError(t, err)
	assert.JSONEq(t, `{"text":"Hello there","usage":{"type":"duration","seconds":7}}`, string(resp.Body))
	assert.Equal(t, "application/json", resp.Headers["Content-Type"])
	assert.Equal(t, domain.Usage{AudioSeconds: 7}, resp.Usage)
}

// @scenario "Streaming a transcription on a provider that cannot stream is refused"
func TestStreamingAudioIsRefusedOnProvidersThatCannotStream(t *testing.T) {
	t.Parallel()

	router := &BifrostRouter{}
	gemini := domain.Credential{ID: "gemini_1", ProviderID: domain.ProviderGemini, APIKey: "goog"}

	_, err := transcriptionStream(router, transcriptionRequest(wavFile(1), domain.FormField{Name: "stream", Value: "true"}), "gemini-2.5-flash", gemini)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrUnsupportedParameter), "got %v", err)

	_, err = speechStream(router, speechRequest(`{"model":"gemini-2.5-flash-preview-tts","voice":"Kore","input":"Hi","stream_format":"sse"}`),
		"gemini-2.5-flash-preview-tts", gemini)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrUnsupportedParameter), "got %v", err)

	eleven := domain.Credential{ID: "eleven_1", ProviderID: domain.ProviderElevenLabs, APIKey: "xi"}
	_, err = speechStream(router, speechRequest(`{"model":"eleven_flash_v2_5","voice":"voice_1","input":"Hi","stream_format":"sse"}`),
		"eleven_flash_v2_5", eleven)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrUnsupportedParameter), "got %v", err)
}

// @scenario "A provider refusal on a streamed audio route reaches the caller in the provider's words"
func TestSpeechStreamReturnsTheProviderRefusalVerbatim(t *testing.T) {
	t.Parallel()

	const refusal = `{"error":{"message":"stream_format sse is not supported for tts-1","type":"invalid_request_error","code":"unsupported_value"}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Request-Id", "req_refused")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(refusal))
	}))
	defer server.Close()

	_, err := speechStream(openAIAudioRouter(server), speechRequest(`{"model":"tts-1","voice":"alloy","input":"Hello","stream_format":"sse"}`),
		"tts-1", openAIAudioCredential())

	var upstream *domain.UpstreamError
	require.ErrorAs(t, err, &upstream)
	assert.Equal(t, http.StatusBadRequest, upstream.StatusCode)
	assert.JSONEq(t, refusal, string(upstream.Body))
	assert.Equal(t, "invalid_request_error", upstream.ErrorType)
	assert.Equal(t, "unsupported_value", upstream.ErrorCode)
	assert.Equal(t, "req_refused", upstream.Headers["X-Request-Id"])
}

// @scenario "ElevenLabs' streaming synthesis paths reach the vendor unchanged"
func TestElevenLabsStreamVariantsReachTheirVendorPath(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		variant     domain.ElevenLabsSpeechVariant
		wantPath    string
		contentType string
		chunks      []string
	}{
		"stream": {
			variant:     domain.ElevenLabsSpeechStream,
			wantPath:    "/v1/text-to-speech/voice_1/stream",
			contentType: "audio/mpeg",
			chunks:      []string{"ID3-one|", "two|", "three|"},
		},
		"stream with timestamps": {
			variant:     domain.ElevenLabsSpeechStreamWithTimestamps,
			wantPath:    "/v1/text-to-speech/voice_1/stream/with-timestamps",
			contentType: "application/json",
			chunks: []string{
				`{"audio_base64":"AAAA","alignment":{"characters":["H"]}}` + "\n",
				`{"audio_base64":"BBBB","alignment":null}` + "\n",
			},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var produced atomic.Int32
			next := make(chan struct{})
			var gotPath, gotQuery, gotBody string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, _ := io.ReadAll(r.Body)
				gotPath, gotQuery, gotBody = r.URL.Path, r.URL.RawQuery, string(raw)
				w.Header().Set("Content-Type", tc.contentType)
				gatedChunks(w, r, tc.chunks, &produced, next)
			}))
			defer server.Close()

			body := `{"text":"Hello","model_id":"eleven_flash_v2_5"}`
			req := &domain.Request{
				Type: domain.RequestTypeSpeech,
				Body: []byte(body),
				ElevenLabs: &domain.ElevenLabsAudioRequest{
					VoiceID:  "voice_1",
					RawQuery: "output_format=mp3_22050_32&optimize_streaming_latency=3",
					Variant:  tc.variant,
				},
			}
			iter, err := elevenLabsAudioRouter(server).dispatchElevenLabsSpeechStream(
				context.Background(), req, elevenLabsCredential(server))
			require.NoError(t, err)
			defer func() { _ = iter.Close() }()

			for i, want := range tc.chunks {
				require.True(t, iter.Next(context.Background()))
				assert.Equal(t, want, string(iter.Chunk()))
				assert.Equal(t, int32(i+1), produced.Load(), "the chunk is relayed before the next one exists")
				if i < len(tc.chunks)-1 {
					next <- struct{}{}
				}
			}
			assert.False(t, iter.Next(context.Background()))
			require.NoError(t, iter.Err())

			assert.Equal(t, tc.wantPath, gotPath)
			assert.Equal(t, "output_format=mp3_22050_32&optimize_streaming_latency=3", gotQuery)
			assert.JSONEq(t, body, gotBody)
			assert.Equal(t, tc.contentType, domain.StreamHeadersOf(iter)["Content-Type"])
			assert.Equal(t, domain.Usage{InputChars: 5}, iter.Usage())
		})
	}
}

// @scenario "An ElevenLabs synthesis larger than the cap is stopped while it streams"
func TestElevenLabsSpeechCapIsARunningCount(t *testing.T) {
	t.Parallel()

	megabyte := bytes.Repeat([]byte{0x55}, 1<<20)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "audio/mpeg")
		for i := 0; i < (elevenLabsAudioMaxResponseBytes>>20)+4; i++ {
			if _, err := w.Write(megabyte); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	req := &domain.Request{
		Type:       domain.RequestTypeSpeech,
		Body:       []byte(`{"text":"Hello","model_id":"eleven_flash_v2_5"}`),
		ElevenLabs: &domain.ElevenLabsAudioRequest{VoiceID: "voice_1"},
	}
	iter, err := elevenLabsAudioRouter(server).dispatchElevenLabsSpeechStream(
		context.Background(), req, elevenLabsCredential(server))
	require.NoError(t, err, "the cap is not a reason to refuse the head: the audio starts flowing")
	defer func() { _ = iter.Close() }()

	var relayed int64
	for iter.Next(context.Background()) {
		relayed += int64(len(iter.Chunk()))
	}
	require.Error(t, iter.Err())
	assert.True(t, herr.IsCode(iter.Err(), domain.ErrProviderError), "got %v", iter.Err())
	assert.Positive(t, relayed, "bytes under the cap were relayed, not held back")
	assert.LessOrEqual(t, relayed, int64(elevenLabsAudioMaxResponseBytes))
	assert.Equal(t, 5, iter.Usage().InputChars)
}

// @scenario "An ElevenLabs model on the OpenAI speech route streams through the vendor's streaming path"
func TestOpenAIWireSpeechOnElevenLabsUsesTheStreamPath(t *testing.T) {
	t.Parallel()

	var gotPath, gotQuery, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		gotPath, gotQuery, gotBody = r.URL.Path, r.URL.RawQuery, string(raw)
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("pcm-bytes"))
	}))
	defer server.Close()

	req := speechRequest(`{"model":"eleven_flash_v2_5","voice":"voice_1","input":"Olá","response_format":"pcm","speed":1.1}`)
	iter, err := speechStream(elevenLabsAudioRouter(server), req, "eleven_flash_v2_5", elevenLabsCredential(server))
	require.NoError(t, err)

	resp, err := drainAudioStream(context.Background(), iter)
	require.NoError(t, err)
	assert.Equal(t, "/v1/text-to-speech/voice_1/stream", gotPath)
	assert.Equal(t, "output_format=pcm_24000", gotQuery)
	assert.JSONEq(t, `{"text":"Olá","model_id":"eleven_flash_v2_5","voice_settings":{"speed":1.1}}`, gotBody)
	assert.Equal(t, "pcm-bytes", string(resp.Body))
	assert.Equal(t, audioContentType("pcm"), resp.Headers["Content-Type"])
	assert.Equal(t, domain.Usage{InputChars: 3}, resp.Usage)
}

func TestDirectAudioEndpoint(t *testing.T) {
	t.Parallel()

	router := &BifrostRouter{}
	azure := domain.Credential{
		ProviderID:    domain.ProviderAzure,
		APIKey:        "az-key",
		Extra:         map[string]string{"endpoint": "https://acme.openai.azure.com/"},
		DeploymentMap: map[string]string{"gpt-4o-transcribe": "transcribe-prod"},
	}

	got, ok := router.directAudioEndpoint(audioCall{cred: openAIAudioCredential(), model: "gpt-4o-mini-tts"}, "speech")
	require.True(t, ok)
	assert.Equal(t, audioEndpoint{"https://api.openai.com/v1/audio/speech", "Authorization", "Bearer sk-secret"}, got)

	got, ok = router.directAudioEndpoint(audioCall{cred: azure, model: "gpt-4o-mini-tts"}, "speech")
	require.True(t, ok)
	assert.Equal(t, audioEndpoint{"https://acme.openai.azure.com/openai/v1/audio/speech", "api-key", "az-key"}, got)

	got, ok = router.directAudioEndpoint(audioCall{cred: azure, model: "gpt-4o-transcribe"}, "transcriptions")
	require.True(t, ok)
	assert.Equal(t, "https://acme.openai.azure.com/openai/deployments/transcribe-prod/audio/transcriptions"+
		"?api-version="+azureAudioAPIVersion, got.url)

	// A proxy in front of OpenAI, an Azure credential with no key (Entra),
	// and every other provider answer through Bifrost.
	proxied := openAIAudioCredential()
	proxied.Extra = map[string]string{"base_url": "https://proxy.acme.test/v1"}
	for name, cred := range map[string]domain.Credential{
		"openai behind a base url": proxied,
		"azure without a key":      {ProviderID: domain.ProviderAzure, Extra: azure.Extra},
		"anthropic":                {ProviderID: domain.ProviderAnthropic, APIKey: "sk-ant"},
	} {
		_, ok := router.directAudioEndpoint(audioCall{cred: cred, model: "m"}, "speech")
		assert.False(t, ok, name)
	}
}

func TestUploadedAudioSeconds(t *testing.T) {
	t.Parallel()

	streamedWAV := wavFile(2)
	binary.LittleEndian.PutUint32(streamedWAV[40:44], 0xFFFFFFFF)

	flac := append([]byte("fLaC\x00\x00\x00\x22"), make([]byte, 34)...)
	// STREAMINFO: 16 kHz, 48000 samples.
	flac[18], flac[19], flac[20] = 0x03, 0xE8, 0x00
	binary.BigEndian.PutUint32(flac[22:26], 48000)

	ogg := make([]byte, 0, 200)
	ogg = append(ogg, "OggS"...)
	ogg = append(ogg, make([]byte, 24)...)
	ogg = append(ogg, "OpusHead"...)
	ogg = append(ogg, make([]byte, 30)...)
	ogg = append(ogg, "OggS\x00\x04"...)
	ogg = binary.LittleEndian.AppendUint64(ogg, 96000)
	ogg = append(ogg, make([]byte, 20)...)

	mvhd := make([]byte, 20)
	binary.BigEndian.PutUint32(mvhd[12:16], 1000)
	binary.BigEndian.PutUint32(mvhd[16:20], 4500)
	box := func(kind string, payload []byte) []byte {
		out := binary.BigEndian.AppendUint32(nil, uint32(8+len(payload)))
		return append(append(out, kind...), payload...)
	}
	mp4 := append(box("ftyp", []byte("M4A \x00\x00\x00\x00")), box("moov", box("mvhd", mvhd))...)

	// MPEG1 Layer III, 128 kbps, 44.1 kHz: 16000 bytes a second.
	mp3 := append([]byte{0xFF, 0xFB, 0x90, 0x00}, make([]byte, 32000-4)...)

	cases := map[string]struct {
		file []byte
		want float64
	}{
		"wav":                       {wavFile(2), 2},
		"wav streamed without size": {streamedWAV, 2},
		"flac":                      {flac, 3},
		"ogg opus":                  {ogg, 2},
		"mp4":                       {mp4, 4.5},
		"mp3 constant bitrate":      {mp3, 2},
		"unrecognized container":    {bytes.Repeat([]byte{0x1A}, 16000), 2},
	}
	for name, tc := range cases {
		assert.InDelta(t, tc.want, uploadedAudioSeconds(tc.file), 0.001, name)
	}
}

// readProviderForm reads what the gateway posted to the stand-in provider:
// the text parts by name, and the audio.
func readProviderForm(t *testing.T, r *http.Request) (map[string][]string, []byte) {
	t.Helper()
	form := map[string][]string{}
	var file []byte
	for _, part := range readSentParts(t, r) {
		if part.filename != "" {
			file = []byte(part.value)
			continue
		}
		form[part.name] = append(form[part.name], part.value)
	}
	return form, file
}

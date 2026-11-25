package providers

// The non-streaming transcription dispatch on the credentials that speak
// OpenAI's wire: every form part reaches the provider, and the provider's
// body comes back unchanged in every response format.
//
// Binds specs/ai-gateway/audio-endpoints.feature.

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type sentPart struct {
	name     string
	filename string
	value    string
}

// readSentParts reads the provider-side multipart body part by part, so the
// order the gateway wrote is visible.
func readSentParts(t *testing.T, r *http.Request) []sentPart {
	t.Helper()
	reader, err := r.MultipartReader()
	if err != nil {
		t.Errorf("the provider received a body that is not multipart: %v", err)
		return nil
	}
	var parts []sentPart
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			return parts
		}
		if err != nil {
			t.Errorf("reading the multipart body: %v", err)
			return parts
		}
		data, _ := io.ReadAll(part)
		parts = append(parts, sentPart{name: part.FormName(), filename: part.FileName(), value: string(data)})
	}
}

func transcribe(r *BifrostRouter, req *domain.Request, model string) (*domain.Response, error) {
	return r.dispatchTranscription(context.Background(), req, bfschemas.OpenAI, model, openAIAudioCredential())
}

// @scenario "Every transcription form field reaches the provider as the caller sent it"
func TestTranscriptionForwardsEveryFormFieldInOrder(t *testing.T) {
	t.Parallel()

	var sent []sentPart
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sent = readSentParts(t, r)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"ok"}`))
	}))
	defer server.Close()

	fields := []domain.FormField{
		{Name: "response_format", Value: "diarized_json"},
		{Name: "chunking_strategy", Value: `{"type":"server_vad","silence_duration_ms":400}`},
		{Name: "known_speaker_names[]", Value: "agent"},
		{Name: "known_speaker_names[]", Value: "caller"},
		{Name: "known_speaker_references[]", Value: "data:audio/wav;base64,QUdFTlQ="},
		{Name: "known_speaker_references[]", Value: "data:audio/wav;base64,Q0FMTEVS"},
		{Name: "timestamp_granularities[]", Value: "word"},
		{Name: "timestamp_granularities[]", Value: "segment"},
		{Name: "include[]", Value: "logprobs"},
		{Name: "stream", Value: "false"},
		{Name: "language", Value: "pt"},
		{Name: "prompt", Value: "Olá, \"quoted\"\nsecond line"},
		{Name: "temperature", Value: "0.2"},
		{Name: "an_option_added_next_year", Value: "kept"},
	}
	audio := wavFile(1)
	_, err := transcribe(openAIAudioRouter(server), transcriptionRequest(audio, fields...), "gpt-4o-transcribe-diarize")
	require.NoError(t, err)

	want := []sentPart{{name: "model", value: "gpt-4o-transcribe-diarize"}}
	for _, f := range fields {
		want = append(want, sentPart{name: f.Name, value: f.Value})
	}
	want = append(want, sentPart{name: "file", filename: "meeting.wav", value: string(audio)})
	assert.Equal(t, want, sent, "the resolved model, then every part in the caller's order, then the audio")
}

// @scenario "A transcript comes back in the response format the caller asked for"
func TestTranscriptionRelaysEveryResponseFormatUnchanged(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		contentType string
		body        string
		want        domain.Usage
	}{
		"json": {
			contentType: "application/json",
			body: `{"text":"Hello there.","usage":{"type":"tokens","input_tokens":40,"output_tokens":6,"total_tokens":46,` +
				`"input_token_details":{"audio_tokens":30,"text_tokens":10}}}`,
			want: domain.Usage{PromptTokens: 40, CompletionTokens: 6, TotalTokens: 46}.
				SplitAudioTokens(domain.AudioTokenSplit{InputAudio: 30, InputText: 10}),
		},
		"text": {
			contentType: "text/plain; charset=utf-8",
			body:        "Hello there.\n",
			want:        domain.Usage{AudioSeconds: 2},
		},
		"srt": {
			contentType: "text/plain; charset=utf-8",
			body:        "1\n00:00:00,000 --> 00:00:02,000\nHello there.\n\n",
			want:        domain.Usage{AudioSeconds: 2},
		},
		"vtt": {
			contentType: "text/vtt; charset=utf-8",
			body:        "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello there.\n\n",
			want:        domain.Usage{AudioSeconds: 2},
		},
		"verbose_json": {
			contentType: "application/json",
			body: `{"task":"transcribe","language":"english","duration":1.92,"text":"Hello there.",` +
				`"words":[{"word":"Hello","start":0.0,"end":0.42},{"word":"there","start":0.42,"end":0.9}],` +
				`"usage":{"type":"duration","seconds":2}}`,
			want: domain.Usage{AudioSeconds: 2},
		},
		"diarized_json": {
			contentType: "application/json",
			body: `{"task":"transcribe","duration":3.5,"text":"Hello there. Hi.","segments":[` +
				`{"type":"transcript.text.segment","id":"seg_0","speaker":"A","start":0.0,"end":1.4,"text":"Hello there."},` +
				`{"type":"transcript.text.segment","id":"seg_1","speaker":"B","start":1.6,"end":3.5,"text":"Hi."}],` +
				`"usage":{"type":"tokens","input_tokens":35,"output_tokens":12,"total_tokens":47}}`,
			want: domain.Usage{PromptTokens: 35, CompletionTokens: 12, TotalTokens: 47},
		},
	}
	for format, tc := range cases {
		t.Run(format, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", tc.contentType)
				w.Header().Set("Openai-Organization", "acme-internal")
				w.Header().Set("X-Request-Id", "req_stt_1")
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			req := transcriptionRequest(wavFile(2), domain.FormField{Name: "response_format", Value: format})
			resp, err := transcribe(openAIAudioRouter(server), req, "gpt-4o-transcribe-diarize")
			require.NoError(t, err)

			assert.Equal(t, tc.body, string(resp.Body), "the provider's body, byte for byte")
			assert.Equal(t, tc.contentType, resp.Headers["Content-Type"])
			assert.Equal(t, "req_stt_1", resp.Headers["X-Request-Id"])
			assert.NotContains(t, resp.Headers, "Openai-Organization",
				"the provider account name stays inside the gateway")
			assert.NotContains(t, string(resp.Body), "extra_fields")
			assert.Equal(t, tc.want, resp.Usage)
		})
	}
}

// @scenario "A transcript served through Bifrost carries no internal fields"
func TestBifrostTranscriptBodyCarriesNoExtraFields(t *testing.T) {
	t.Parallel()

	resp := &bfschemas.BifrostTranscriptionResponse{Text: "Hello there."}
	resp.ExtraFields.RawResponse = map[string]any{"text": "Hello there."}
	resp.ExtraFields.Provider = bfschemas.Elevenlabs

	body := transcriptionWireBody(resp)
	assert.NotContains(t, string(body), "extra_fields")
	assert.NotContains(t, string(body), "raw_response")
	assert.Contains(t, string(body), `"text":"Hello there."`)
}

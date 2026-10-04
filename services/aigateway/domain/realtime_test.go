package domain_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// @scenario "Audio tokens are taken out of the text totals before rating"
func TestParseRealtimeUsageSplitsAudioFromText(t *testing.T) {
	t.Parallel()

	// The shape OpenAI reports on response.done: audio counts sit INSIDE the
	// input and output totals.
	body := []byte(`{
	  "total_tokens": 1000,
	  "input_tokens": 500,
	  "output_tokens": 500,
	  "input_token_details": {"cached_tokens": 0, "text_tokens": 100, "audio_tokens": 400},
	  "output_token_details": {"text_tokens": 150, "audio_tokens": 350}
	}`)

	usage, err := domain.ParseRealtimeUsage(body)
	require.NoError(t, err)

	assert.Equal(t, 400, usage.InputAudioTokens)
	assert.Equal(t, 350, usage.OutputAudioTokens)
	assert.Equal(t, 100, usage.PromptTokens,
		"the text side is what is left once the audio is out of the total")
	assert.Equal(t, 150, usage.CompletionTokens)
	assert.Equal(t, 500, usage.PromptTokens+usage.InputAudioTokens,
		"the two halves still add up to what the provider reported")
}

func TestParseRealtimeUsageAcceptsTheWholeEvent(t *testing.T) {
	t.Parallel()

	// A client that posts back the whole response.done event, and one that
	// posts only its usage object, must both work: both are what a caller
	// naturally has in hand.
	shapes := map[string][]byte{
		"bare usage":     []byte(`{"input_tokens": 10, "output_tokens": 4}`),
		"under usage":    []byte(`{"usage": {"input_tokens": 10, "output_tokens": 4}}`),
		"under response": []byte(`{"type":"response.done","response":{"usage":{"input_tokens":10,"output_tokens":4}}}`),
	}
	for name, body := range shapes {
		t.Run(name, func(t *testing.T) {
			usage, err := domain.ParseRealtimeUsage(body)
			require.NoError(t, err)
			assert.Equal(t, 10, usage.PromptTokens)
			assert.Equal(t, 4, usage.CompletionTokens)
		})
	}
}

func TestParseRealtimeUsageRejectsWhatIsNotAUsageReport(t *testing.T) {
	t.Parallel()

	for name, body := range map[string][]byte{
		"empty":         []byte(``),
		"not an object": []byte(`[1,2,3]`),
		"no counts":     []byte(`{"type":"response.done"}`),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := domain.ParseRealtimeUsage(body)
			assert.Error(t, err, "a report with no counts must be refused, not read as a free call")
		})
	}
}

func TestParseRealtimeUsageIgnoresAnImpossibleCacheSplit(t *testing.T) {
	t.Parallel()

	// A cached count larger than the total it belongs to is not a split that
	// can be trusted, and subtracting it would report negative fresh input.
	usage, err := domain.ParseRealtimeUsage([]byte(
		`{"input_tokens": 10, "output_tokens": 2, "input_token_details": {"cached_tokens": 99}}`))
	require.NoError(t, err)
	assert.Equal(t, 0, usage.CacheReadTokens)
	assert.Equal(t, 10, usage.BillableInputTokens())
}

// @scenario "The client-secret route is served only by an OpenAI credential"
func TestRealtimeSurfacesNameOneVendorEach(t *testing.T) {
	t.Parallel()

	openai := domain.OpenAIRealtimeSurface()
	assert.Equal(t, []domain.ProviderID{domain.ProviderOpenAI}, openai.Providers)
	assert.Equal(t, "/v1/realtime/client_secrets", openai.Name)

	eleven := domain.ElevenLabsConvAISurface()
	assert.Equal(t, []domain.ProviderID{domain.ProviderElevenLabs}, eleven.Providers)
	assert.Equal(t, "/v1/convai/conversation/get-signed-url", eleven.Name)
}

func TestRealtimeRequestReportsItsOwnSurfaceAndModelPath(t *testing.T) {
	t.Parallel()

	req := &domain.Request{
		Type:    domain.RequestTypeRealtimeSession,
		Surface: domain.OpenAIRealtimeSurface(),
	}
	assert.Equal(t, domain.OpenAIRealtimeSurface(), req.InboundSurface())
	assert.Equal(t, "session.model", req.ModelBodyPath(),
		"the realtime mint carries its model inside the session object the vendor reads")

	chat := &domain.Request{Type: domain.RequestTypeChat}
	assert.Equal(t, domain.Surface{}, chat.InboundSurface(),
		"a translated route pins no vendor")
	assert.Equal(t, "model", chat.ModelBodyPath())
}

// @scenario "Cached audio tokens stay billed as audio"
func TestParseRealtimeUsageReadsTheCachedTokenSplit(t *testing.T) {
	t.Parallel()

	type want struct{ text, audio, cacheRead, billable, outText, outAudio int }
	cases := map[string]struct {
		body string
		want want
	}{
		// The vendor's documented gpt-realtime-2.1 answer: the whole cache
		// hit is text.
		"gpt-realtime-2.1, cached text only": {
			body: `{"type":"response.done","response":{"id":"resp_1","usage":{
			  "total_tokens":253,"input_tokens":132,"output_tokens":121,
			  "input_token_details":{"text_tokens":119,"audio_tokens":13,"image_tokens":0,"cached_tokens":64,
			    "cached_tokens_details":{"text_tokens":64,"audio_tokens":0,"image_tokens":0}},
			  "output_token_details":{"text_tokens":30,"audio_tokens":91}}}}`,
			want: want{text: 119, audio: 13, cacheRead: 64, billable: 55, outText: 30, outAudio: 91},
		},
		// A long call replays its audio history from the cache. Only the text
		// part is cache-read; all 900 audio tokens stay at the audio rate.
		"gpt-realtime-2.1, cache is mostly audio": {
			body: `{"usage":{"input_tokens":1000,"output_tokens":300,
			  "input_token_details":{"text_tokens":100,"audio_tokens":900,"cached_tokens":880,
			    "cached_tokens_details":{"text_tokens":80,"audio_tokens":800}},
			  "output_token_details":{"text_tokens":50,"audio_tokens":250}}}`,
			want: want{text: 100, audio: 900, cacheRead: 80, billable: 20, outText: 50, outAudio: 250},
		},
		"gpt-realtime-2.1-mini, cached audio only": {
			body: `{"usage":{"input_tokens":640,"output_tokens":210,
			  "input_token_details":{"text_tokens":40,"audio_tokens":600,"cached_tokens":512,
			    "cached_tokens_details":{"text_tokens":0,"audio_tokens":512}},
			  "output_token_details":{"text_tokens":10,"audio_tokens":200}}}`,
			want: want{text: 40, audio: 600, cacheRead: 0, billable: 40, outText: 10, outAudio: 200},
		},
		"gpt-realtime-2.1-mini, nothing cached": {
			body: `{"usage":{"input_tokens":70,"output_tokens":45,
			  "input_token_details":{"text_tokens":20,"audio_tokens":50,"cached_tokens":0,
			    "cached_tokens_details":{"text_tokens":0,"audio_tokens":0}},
			  "output_token_details":{"text_tokens":5,"audio_tokens":40}}}`,
			want: want{text: 20, audio: 50, cacheRead: 0, billable: 20, outText: 5, outAudio: 40},
		},
		// No details object: the flat count fits inside the text total, so it
		// is taken as cached text.
		"no details, flat count fits the text": {
			body: `{"usage":{"input_tokens":132,"output_tokens":121,
			  "input_token_details":{"text_tokens":119,"audio_tokens":13,"cached_tokens":64},
			  "output_token_details":{"text_tokens":30,"audio_tokens":91}}}`,
			want: want{text: 119, audio: 13, cacheRead: 64, billable: 55, outText: 30, outAudio: 91},
		},
		// No details object and a flat count past the text total: it cannot
		// be split, so the session bills as uncached.
		"no details, flat count exceeds the text": {
			body: `{"usage":{"input_tokens":1000,"output_tokens":300,
			  "input_token_details":{"text_tokens":100,"audio_tokens":900,"cached_tokens":880},
			  "output_token_details":{"text_tokens":50,"audio_tokens":250}}}`,
			want: want{text: 100, audio: 900, cacheRead: 0, billable: 100, outText: 50, outAudio: 250},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			usage, err := domain.ParseRealtimeUsage([]byte(tc.body))
			require.NoError(t, err)
			got := want{
				text: usage.PromptTokens, audio: usage.InputAudioTokens,
				cacheRead: usage.CacheReadTokens, billable: usage.BillableInputTokens(),
				outText: usage.CompletionTokens, outAudio: usage.OutputAudioTokens,
			}
			assert.Equal(t, tc.want, got)
		})
	}
}

// @scenario "A transcription event is priced as transcription"
func TestParseRealtimeUsagePostReadsBothTranscriptionUsageShapes(t *testing.T) {
	t.Parallel()

	tokens, err := domain.ParseRealtimeUsagePost([]byte(`{
	  "type":"conversation.item.input_audio_transcription.completed","item_id":"item_1",
	  "transcript":"never read",
	  "usage":{"type":"tokens","total_tokens":26,"input_tokens":17,
	    "input_token_details":{"text_tokens":0,"audio_tokens":17},"output_tokens":9}}`))
	require.NoError(t, err)
	require.Len(t, tokens.Entries, 1)
	assert.Equal(t, "item_1", tokens.Entries[0].ReportKey)
	assert.Equal(t, domain.RealtimePricedAsTranscription, tokens.Entries[0].PricedAs)
	assert.Equal(t, 17, tokens.Entries[0].Usage.InputAudioTokens)
	assert.Equal(t, 0, tokens.Entries[0].Usage.PromptTokens, "all seventeen input tokens were audio")
	assert.Equal(t, 9, tokens.Entries[0].Usage.CompletionTokens)

	duration, err := domain.ParseRealtimeUsagePost([]byte(`{
	  "type":"conversation.item.input_audio_transcription.completed","item_id":"item_2",
	  "usage":{"type":"duration","seconds":4}}`))
	require.NoError(t, err)
	require.Len(t, duration.Entries, 1)
	assert.Equal(t, "item_2", duration.Entries[0].ReportKey)
	assert.InDelta(t, 4.0, duration.Entries[0].Usage.AudioSeconds, 0.0001)

	_, err = domain.ParseRealtimeUsagePost([]byte(`{
	  "type":"conversation.item.input_audio_transcription.completed",
	  "usage":{"type":"duration","seconds":4}}`))
	require.Error(t, err, "usage with no item id has no key to record it once under")
}

func TestParseRealtimeUsagePostKeepsEveryShapeAClientHasInHand(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		body    string
		key     string
		entries int
		final   bool
	}{
		"bare usage":             {body: `{"input_tokens":10,"output_tokens":4}`, entries: 1},
		"under usage":            {body: `{"usage":{"input_tokens":10,"output_tokens":4}}`, entries: 1},
		"untyped response":       {body: `{"response":{"usage":{"input_tokens":10,"output_tokens":4}}}`, entries: 1},
		"event with no id":       {body: `{"type":"response.done","response":{"usage":{"input_tokens":10,"output_tokens":4}}}`, entries: 1},
		"event with an id":       {body: `{"type":"response.done","response":{"id":"resp_1","usage":{"input_tokens":10,"output_tokens":4}}}`, entries: 1, key: "resp_1"},
		"usage with an id":       {body: `{"id":"mine-1","usage":{"input_tokens":10,"output_tokens":4}}`, entries: 1, key: "mine-1"},
		"response with no usage": {body: `{"type":"response.done","response":{"id":"resp_2","status":"incomplete","usage":null}}`},
		"bare close":             {body: `{"final":true}`, final: true},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			post, err := domain.ParseRealtimeUsagePost([]byte(tc.body))
			require.NoError(t, err)
			require.Len(t, post.Entries, tc.entries)
			assert.Equal(t, tc.final, post.Final)
			if tc.entries == 1 {
				assert.Equal(t, tc.key, post.Entries[0].ReportKey)
			}
		})
	}
}

// @scenario "A batch over the cap is refused"
func TestParseRealtimeUsagePostCapsABatch(t *testing.T) {
	t.Parallel()

	event := `{"type":"response.done","response":{"id":"resp_1","usage":{"input_tokens":1,"output_tokens":1}}}`
	body := `{"events":[` + strings.Repeat(event+",", domain.MaxRealtimeUsageEvents) + event + `]}`

	_, err := domain.ParseRealtimeUsagePost([]byte(body))
	require.Error(t, err)
}

func TestRealtimeTranscriptionModelIsACatalogID(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "openai/gpt-transcribe", domain.RealtimeTranscriptionModel(
		[]byte(`{"session":{"audio":{"input":{"transcription":{"model":"gpt-transcribe"}}}}}`)))
	assert.Equal(t, "openai/whisper-1", domain.RealtimeTranscriptionModel(
		[]byte(`{"session":{"audio":{"input":{"transcription":{"model":"openai/whisper-1"}}}}}`)))
	assert.Empty(t, domain.RealtimeTranscriptionModel([]byte(`{"session":{"model":"gpt-realtime-2.1"}}`)))
}

// @scenario "Each token type bills under the default model of its socket"
func TestElevenLabsTokenTypesNameTheirKindAndDefaultModel(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		kind  domain.RealtimeSessionKind
		model string
	}{
		"tts_websocket":   {domain.RealtimeKindTTSSocket, "eleven_multilingual_v2"},
		"ttd_websocket":   {domain.RealtimeKindTTSSocket, "eleven_v3_conversational"},
		"realtime_scribe": {domain.RealtimeKindSTTSocket, "scribe_v2_realtime"},
		"batch_scribe":    {domain.RealtimeKindSTTBatch, "scribe_v2"},
	}
	for raw, tc := range cases {
		tokenType, ok := domain.ParseElevenLabsTokenType(raw)
		require.True(t, ok, raw)
		assert.Equal(t, tc.model, tokenType.DefaultModel())
		session := domain.RealtimeSessionRequest{Vendor: domain.RealtimeVendorElevenLabs, TokenType: tokenType}
		assert.Equal(t, tc.kind, session.Kind())
	}
	_, ok := domain.ParseElevenLabsTokenType("convai")
	assert.False(t, ok)

	assert.Equal(t, domain.RealtimeKindConvAI,
		domain.RealtimeSessionRequest{Vendor: domain.RealtimeVendorElevenLabs}.Kind())
	assert.Equal(t, domain.RealtimeKindRealtime,
		domain.RealtimeSessionRequest{Vendor: domain.RealtimeVendorOpenAI}.Kind())
	assert.Equal(t, []domain.ProviderID{domain.ProviderElevenLabs},
		domain.ElevenLabsSingleUseTokenSurface().Providers)
}

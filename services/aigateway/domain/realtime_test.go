package domain_test

import (
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

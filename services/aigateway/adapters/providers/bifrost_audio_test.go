package providers

// Binds specs/ai-gateway/audio-endpoints.feature: the PCM response-format
// contract. OpenAI's "pcm" is raw PCM16 @ 24kHz; ElevenLabs must be asked
// for pcm_24000 (every tier, right rate), never Bifrost's default pcm_44100
// (Pro-tier-gated, wrong rate for the OpenAI contract).

import (
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// @scenario "PCM means 24kHz on every provider, matching OpenAI semantics"
func TestSpeechResponseFormatFor(t *testing.T) {
	cases := []struct {
		name     string
		provider bfschemas.ModelProvider
		wire     string
		want     string
	}{
		{"elevenlabs pcm becomes 24k", bfschemas.Elevenlabs, "pcm", "pcm_24000"},
		{"elevenlabs pcm case-insensitive", bfschemas.Elevenlabs, "PCM", "pcm_24000"},
		{"elevenlabs mp3 untouched", bfschemas.Elevenlabs, "mp3", "mp3"},
		{"elevenlabs empty untouched", bfschemas.Elevenlabs, "", ""},
		{"openai pcm untouched", bfschemas.OpenAI, "pcm", "pcm"},
		{"openai mp3 untouched", bfschemas.OpenAI, "mp3", "mp3"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, speechResponseFormatFor(tc.provider, tc.wire))
		})
	}
}

// @scenario "A TTS call lands as a trace with character usage"
func TestExtractSpeechUsage_CharacterMeasure(t *testing.T) {
	assert.Equal(t, domain.Usage{}, extractSpeechUsage(nil))
	assert.Equal(t, domain.Usage{}, extractSpeechUsage(&bfschemas.BifrostSpeechResponse{}))

	u := extractSpeechUsage(&bfschemas.BifrostSpeechResponse{
		Usage: &bfschemas.SpeechUsage{
			InputTokens:  12,
			OutputTokens: 34,
			TotalTokens:  46,
			InputChars:   57,
		},
	})
	assert.Equal(t, 57, u.InputChars)
	assert.Equal(t, 12, u.PromptTokens)
	assert.Equal(t, 34, u.CompletionTokens)
	assert.Equal(t, 46, u.TotalTokens)
}

// @scenario "A transcription call lands as a trace with duration usage"
func TestExtractTranscriptionUsage_DurationMeasure(t *testing.T) {
	assert.Equal(t, domain.Usage{}, extractTranscriptionUsage(nil))

	dur := 2.51
	u := extractTranscriptionUsage(&bfschemas.BifrostTranscriptionResponse{Duration: &dur})
	assert.InDelta(t, 2.51, u.AudioSeconds, 1e-9)

	secs := 3
	u = extractTranscriptionUsage(&bfschemas.BifrostTranscriptionResponse{
		Usage: &bfschemas.TranscriptionUsage{Type: "duration", Seconds: &secs},
	})
	assert.InDelta(t, 3.0, u.AudioSeconds, 1e-9)

	in, out, tot := 11, 0, 11
	u = extractTranscriptionUsage(&bfschemas.BifrostTranscriptionResponse{
		Usage: &bfschemas.TranscriptionUsage{
			Type:         "tokens",
			InputTokens:  &in,
			OutputTokens: &out,
			TotalTokens:  &tot,
		},
	})
	assert.Equal(t, 11, u.PromptTokens)
	assert.Equal(t, 11, u.TotalTokens)
}

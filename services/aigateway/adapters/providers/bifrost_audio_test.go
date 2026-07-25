package providers

// Binds specs/ai-gateway/audio-endpoints.feature: the PCM response-format
// contract. OpenAI's "pcm" is raw PCM16 @ 24kHz; ElevenLabs must be asked
// for pcm_24000 (every tier, right rate), never Bifrost's default pcm_44100
// (Pro-tier-gated, wrong rate for the OpenAI contract).

import (
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
)

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

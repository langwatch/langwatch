package spendemitter

// The billable-quantity half of the wire contract: everything a provider
// charges by has to reach the control plane, and the audio counts have to
// arrive disjoint from the text totals they were taken out of.

import (
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// confirmUsage emits one confirmation and returns its decoded usage block.
func confirmUsage(t *testing.T, u domain.Usage) map[string]any {
	t.Helper()
	s := openTestSpool(t, t.TempDir())
	defer s.Close()
	e := NewEmitter(s)

	e.ConfirmSpend(pipeline.SpendOutcome{
		GatewayRequestID: "req_q",
		OccurredAt:       time.Date(2026, 8, 14, 9, 0, 0, 0, time.UTC),
		ProjectID:        "proj_x",
		Usage:            u,
		Model:            "tts-1",
		ModelProviderID:  "mp_1",
		Duration:         time.Second,
	})

	records := drainRecords(t, s, 1)
	require.Equal(t, "confirmSpend", records[0].Command)
	var payload map[string]any
	require.NoError(t, json.Unmarshal(records[0].Payload, &payload))
	usage, ok := payload["usage"].(map[string]any)
	require.True(t, ok)
	return usage
}

/** @scenario The confirm command carries every billable quantity, not only token classes */
func TestConfirmCarriesCharacterAndSecondQuantities(t *testing.T) {
	usage := confirmUsage(t, domain.Usage{
		InputChars:            4000,
		AudioSeconds:          1.234,
		CacheCreation1hTokens: 17,
		CacheCreationTokens:   17,
	})

	assert.EqualValues(t, 4000, usage["input_chars"])
	assert.EqualValues(t, 1234, usage["audio_ms"],
		"seconds travel as whole milliseconds")
	assert.EqualValues(t, 17, usage["cache_creation_1h_tokens"])
}

/** @scenario The confirm command carries every billable quantity, not only token classes */
func TestConfirmStatesAudioTokensApartFromTextTotals(t *testing.T) {
	split := domain.Usage{PromptTokens: 1000, CompletionTokens: 300}.
		SplitAudioTokens(domain.AudioTokenSplit{
			InputAudio: 800, InputText: 200,
			OutputAudio: 250, OutputText: 50,
		})
	usage := confirmUsage(t, split)

	assert.EqualValues(t, 200, usage["input_tokens"])
	assert.EqualValues(t, 800, usage["input_audio_tokens"])
	assert.EqualValues(t, 50, usage["output_tokens"])
	assert.EqualValues(t, 250, usage["output_audio_tokens"])
}

/** @scenario The confirm command carries every billable quantity, not only token classes */
func TestConfirmLeavesATextOnlyPayloadUnchanged(t *testing.T) {
	usage := confirmUsage(t, domain.Usage{
		PromptTokens:        869,
		CompletionTokens:    207,
		CacheReadTokens:     11,
		CacheCreationTokens: 5,
	})

	// The token classes keep the values they always carried, and every
	// quantity the widening added is exactly zero: pure-text traffic prices
	// the same before and after.
	assert.EqualValues(t, 869, usage["input_tokens"])
	assert.EqualValues(t, 207, usage["output_tokens"])
	assert.EqualValues(t, 11, usage["cache_read_input_tokens"])
	assert.EqualValues(t, 5, usage["cache_creation_input_tokens"])
	for _, key := range []string{
		"cache_creation_1h_tokens", "input_audio_tokens",
		"output_audio_tokens", "input_chars", "audio_ms", "reasoning_tokens",
	} {
		assert.EqualValues(t, 0, usage[key], "%s must default to zero", key)
	}
}

func TestAudioMillisRoundsHalfUp(t *testing.T) {
	assert.Equal(t, 1234, audioMillis(1.234))
	assert.Equal(t, 2, audioMillis(0.0015))
	assert.Equal(t, 1, audioMillis(0.0014))
	assert.Equal(t, 60000, audioMillis(60))
}

func TestAudioMillisRefusesAnImplausibleDuration(t *testing.T) {
	assert.Equal(t, 0, audioMillis(math.NaN()))
	assert.Equal(t, 0, audioMillis(math.Inf(1)))
	assert.Equal(t, 0, audioMillis(math.Inf(-1)))
	assert.Equal(t, 0, audioMillis(-1.5))
	assert.Equal(t, 0, audioMillis(25*60*60))
	assert.Equal(t, 0, audioMillis(0))
}

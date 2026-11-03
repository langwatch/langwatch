package gatewaymetrics

// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mediaRelayCount reads gateway_voice_media_relay_total{outcome} from the
// recorder's own registry, and the label names the family carries.
func mediaRelayCount(t *testing.T, r *Recorder, outcome string) (float64, []string) {
	t.Helper()
	families, err := r.Registry().Gather()
	require.NoError(t, err)
	for _, family := range families {
		if family.GetName() != "gateway_voice_media_relay_total" {
			continue
		}
		for _, metric := range family.GetMetric() {
			var labels []string
			matches := false
			for _, label := range metric.GetLabel() {
				labels = append(labels, label.GetName())
				matches = matches || (label.GetName() == "outcome" && label.GetValue() == outcome)
			}
			if matches {
				return metric.GetCounter().GetValue(), labels
			}
		}
	}
	return 0, nil
}

// @scenario "The relay outcome counter has one label"
func TestRecorder_VoiceMediaRelayCountsByOutcome(t *testing.T) {
	t.Parallel()
	r := New()

	r.RecordVoiceMediaRelay("paired")
	r.RecordVoiceMediaRelay("paired")
	r.RecordVoiceMediaRelay("opened")

	paired, labels := mediaRelayCount(t, r, "paired")
	assert.InDelta(t, 2.0, paired, 0.0001)
	assert.Equal(t, []string{"outcome"}, labels, "an id or a scope in a label would be unbounded")
	opened, _ := mediaRelayCount(t, r, "opened")
	assert.InDelta(t, 1.0, opened, 0.0001)
}

// @scenario "The relay outcome counter has one label"
func TestRecorder_VoiceMediaRelayNilIsSafe(t *testing.T) {
	t.Parallel()
	var r *Recorder

	assert.NotPanics(t, func() { r.RecordVoiceMediaRelay("opened") })
}

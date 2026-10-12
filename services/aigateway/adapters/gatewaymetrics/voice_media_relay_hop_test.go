package gatewaymetrics

// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var hopOutcomes = []string{"hop_joined", "refused_owner_unreachable", "refused_owner_invalid", "refused_hop_busy"}

// @scenario "The hop outcomes are documented"
func TestVoiceMediaRelayHopOutcomesAreDocumented(t *testing.T) {
	t.Parallel()
	body, err := os.ReadFile(filepath.Join(repoRoot(t), "docs", "ai-gateway", "observability.mdx"))
	require.NoError(t, err)
	var row string
	for _, line := range strings.Split(string(body), "\n") {
		if strings.Contains(line, "gateway_voice_media_relay_total") {
			row = line
		}
	}
	require.NotEmpty(t, row, "the relay counter has no row in observability.mdx")

	for _, outcome := range hopOutcomes {
		t.Run(outcome, func(t *testing.T) {
			assert.Contains(t, row, "`"+outcome+"`")
		})
	}
}

// @scenario "The hop outcomes are documented"
func TestVoiceMediaRelayHopOutcomesAreInTheMetricHelp(t *testing.T) {
	t.Parallel()
	r := New()
	r.RecordVoiceMediaRelay("opened") // a family is exported once it has a sample
	families, err := r.Registry().Gather()
	require.NoError(t, err)
	var help string
	for _, family := range families {
		if family.GetName() == "gateway_voice_media_relay_total" {
			help = family.GetHelp()
		}
	}
	require.NotEmpty(t, help)

	for _, outcome := range hopOutcomes {
		t.Run(outcome, func(t *testing.T) {
			assert.Contains(t, help, outcome)
		})
	}
}

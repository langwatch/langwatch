package aigateway

// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var mediaRelayEnv = []string{
	"LW_GATEWAY_VOICE_PENDING_TTL_SECONDS",
	"LW_GATEWAY_VOICE_MAX_RELAY_SECONDS",
	"LW_GATEWAY_VOICE_MAX_MEDIA_RELAYS",
	"LW_GATEWAY_VOICE_MAX_PENDING_RELAYS_PER_SCOPE",
	"LW_GATEWAY_VOICE_MAX_RELAYS_PER_SCOPE",
	"GATEWAY_POD_IP",
}

func loadWithMediaRelayEnv(t *testing.T, env map[string]string) (Config, error) {
	t.Helper()
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	for _, name := range mediaRelayEnv {
		t.Setenv(name, env[name])
	}
	return LoadConfig(context.Background())
}

// @scenario "Relay limits come from the environment"
func TestLoadConfig_MediaRelayDefaults(t *testing.T) {
	cfg, err := loadWithMediaRelayEnv(t, nil)
	require.NoError(t, err)

	t.Run("pending time to live", func(t *testing.T) { assert.Equal(t, int64(150), cfg.Voice.PendingTTLSeconds) })
	t.Run("maximum relay duration", func(t *testing.T) { assert.Equal(t, int64(330), cfg.Voice.MaxRelaySeconds) })
	t.Run("maximum relays", func(t *testing.T) { assert.Equal(t, 500, cfg.Voice.MaxMediaRelays) })
	t.Run("pending relays per scope", func(t *testing.T) { assert.Equal(t, 20, cfg.Voice.MaxPendingRelaysPerScope) })
	t.Run("relays per scope", func(t *testing.T) { assert.Equal(t, 50, cfg.Voice.MaxRelaysPerScope) })
	t.Run("pod address", func(t *testing.T) { assert.Empty(t, cfg.PodIP) })
}

// @scenario "Relay limits come from the environment"
func TestLoadConfig_MediaRelayOverrides(t *testing.T) {
	cfg, err := loadWithMediaRelayEnv(t, map[string]string{
		"LW_GATEWAY_VOICE_PENDING_TTL_SECONDS":          "5",
		"LW_GATEWAY_VOICE_MAX_RELAY_SECONDS":            "60",
		"LW_GATEWAY_VOICE_MAX_MEDIA_RELAYS":             "7",
		"LW_GATEWAY_VOICE_MAX_PENDING_RELAYS_PER_SCOPE": "3",
		"LW_GATEWAY_VOICE_MAX_RELAYS_PER_SCOPE":         "4",
		"GATEWAY_POD_IP":                                "10.1.2.3",
	})
	require.NoError(t, err)

	t.Run("pending time to live", func(t *testing.T) { assert.Equal(t, int64(5), cfg.Voice.PendingTTLSeconds) })
	t.Run("maximum relay duration", func(t *testing.T) { assert.Equal(t, int64(60), cfg.Voice.MaxRelaySeconds) })
	t.Run("maximum relays", func(t *testing.T) { assert.Equal(t, 7, cfg.Voice.MaxMediaRelays) })
	t.Run("pending relays per scope", func(t *testing.T) { assert.Equal(t, 3, cfg.Voice.MaxPendingRelaysPerScope) })
	t.Run("relays per scope", func(t *testing.T) { assert.Equal(t, 4, cfg.Voice.MaxRelaysPerScope) })
	t.Run("pod address", func(t *testing.T) { assert.Equal(t, "10.1.2.3", cfg.PodIP) })
}

// @scenario "Relay limits come from the environment"
func TestLoadConfig_MediaRelayRefusesNegativeValues(t *testing.T) {
	for _, name := range mediaRelayEnv[:5] {
		t.Run(name, func(t *testing.T) {
			_, err := loadWithMediaRelayEnv(t, map[string]string{name: "-1"})

			assert.Error(t, err)
		})
	}
}

package aigateway

// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var mediaRelayHopEnv = []string{
	"GATEWAY_RELAY_HOP_ADDR",
	"LW_GATEWAY_VOICE_HOP_TIMEOUT_SECONDS",
	"LW_GATEWAY_VOICE_MAX_HOP_DIALS",
	"LW_GATEWAY_VOICE_RELAY_ID_KEY",
}

func loadWithHopEnv(t *testing.T, env map[string]string) (Config, error) {
	t.Helper()
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	for _, name := range mediaRelayHopEnv {
		t.Setenv(name, env[name])
	}
	return LoadConfig(context.Background())
}

// @scenario "Hop settings come from the environment"
func TestLoadConfig_RelayHopDefaults(t *testing.T) {
	cfg, err := loadWithHopEnv(t, nil)
	require.NoError(t, err)

	t.Run("hop address", func(t *testing.T) { assert.Equal(t, ":5564", cfg.RelayHopAddr) })
	t.Run("hop timeout", func(t *testing.T) { assert.Equal(t, int64(3), cfg.Voice.HopTimeoutSeconds) })
	t.Run("maximum hop dials", func(t *testing.T) { assert.Equal(t, 64, cfg.Voice.MaxHopDials) })
	t.Run("relay id key", func(t *testing.T) { assert.Empty(t, cfg.Voice.RelayIDKey) })
}

// @scenario "Hop settings come from the environment"
func TestLoadConfig_RelayHopOverrides(t *testing.T) {
	key := strings.Repeat("k", 32)
	cfg, err := loadWithHopEnv(t, map[string]string{
		"GATEWAY_RELAY_HOP_ADDR":               "0.0.0.0:6000",
		"LW_GATEWAY_VOICE_HOP_TIMEOUT_SECONDS": "5",
		"LW_GATEWAY_VOICE_MAX_HOP_DIALS":       "9",
		"LW_GATEWAY_VOICE_RELAY_ID_KEY":        key,
	})
	require.NoError(t, err)

	t.Run("hop address", func(t *testing.T) { assert.Equal(t, "0.0.0.0:6000", cfg.RelayHopAddr) })
	t.Run("hop timeout", func(t *testing.T) { assert.Equal(t, int64(5), cfg.Voice.HopTimeoutSeconds) })
	t.Run("maximum hop dials", func(t *testing.T) { assert.Equal(t, 9, cfg.Voice.MaxHopDials) })
	t.Run("relay id key", func(t *testing.T) { assert.Equal(t, key, cfg.Voice.RelayIDKey) })
}

// @scenario "A negative hop setting is refused"
func TestLoadConfig_RelayHopRefusesNegativeValues(t *testing.T) {
	for _, name := range []string{"LW_GATEWAY_VOICE_HOP_TIMEOUT_SECONDS", "LW_GATEWAY_VOICE_MAX_HOP_DIALS"} {
		t.Run(name, func(t *testing.T) {
			_, err := loadWithHopEnv(t, map[string]string{name: "-1"})

			assert.ErrorContains(t, err, name)
		})
	}
}

// @scenario "The hop address must be a host and a port"
func TestLoadConfig_RelayHopRefusesAMalformedAddress(t *testing.T) {
	for _, addr := range []string{"garbage", "5564", ":", ":0", ":notaport", ":70000", "host:"} {
		t.Run(addr, func(t *testing.T) {
			_, err := loadWithHopEnv(t, map[string]string{"GATEWAY_RELAY_HOP_ADDR": addr})

			assert.ErrorContains(t, err, "GATEWAY_RELAY_HOP_ADDR")
		})
	}
}

// @scenario "The relay id key must be at least 32 bytes"
func TestLoadConfig_RelayIDKeyOf31BytesIsRefused(t *testing.T) {
	_, err := loadWithHopEnv(t, map[string]string{"LW_GATEWAY_VOICE_RELAY_ID_KEY": strings.Repeat("k", 31)})

	assert.ErrorContains(t, err, "LW_GATEWAY_VOICE_RELAY_ID_KEY")
}

// @scenario "The relay id key must be at least 32 bytes"
func TestLoadConfig_RelayIDKeyOf32BytesIsAccepted(t *testing.T) {
	_, err := loadWithHopEnv(t, map[string]string{"LW_GATEWAY_VOICE_RELAY_ID_KEY": strings.Repeat("k", 32)})

	assert.NoError(t, err)
}

// @scenario "The relay id key must be at least 32 bytes"
func TestLoadConfig_RelayIDKeyLengthCountsBytesNotCharacters(t *testing.T) {
	// 16 two-byte characters are 32 bytes.
	_, err := loadWithHopEnv(t, map[string]string{"LW_GATEWAY_VOICE_RELAY_ID_KEY": strings.Repeat("é", 16)})

	assert.NoError(t, err)
}

// @scenario "The relay id key is never echoed in a refusal"
func TestLoadConfig_RelayIDKeyRefusalDoesNotEchoTheKey(t *testing.T) {
	short := "short-secret-key-value"
	_, err := loadWithHopEnv(t, map[string]string{"LW_GATEWAY_VOICE_RELAY_ID_KEY": short})

	require.Error(t, err)
	assert.NotContains(t, err.Error(), short)
}

// @scenario "The hop port is read from the hop address"
func TestRelayHopPort(t *testing.T) {
	for addr, want := range map[string]int{
		":5564":          5564,
		"0.0.0.0:6000":   6000,
		"[::]:7000":      7000,
		"127.0.0.1:5570": 5570,
	} {
		t.Run(addr, func(t *testing.T) {
			got, err := relayHopPort(addr)

			require.NoError(t, err)
			assert.Equal(t, want, got)
		})
	}
	for _, addr := range []string{"", "garbage", ":0", ":x", ":70000"} {
		t.Run("refuses "+addr, func(t *testing.T) {
			_, err := relayHopPort(addr)

			assert.Error(t, err)
		})
	}
}

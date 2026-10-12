package aigateway

// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

// mediaRelayOptions is the one place configuration becomes hub options. A
// setting that is loaded and validated but never passed on does nothing, and
// nothing else in the tests would notice.
//
// @scenario "The media relay hub is built from the configuration"
func TestMediaRelayOptions_CarryTheHopSettingsFromTheConfiguration(t *testing.T) {
	cfg := defaultConfig()
	cfg.ControlPlane.InternalSecret = "internal-1"
	cfg.PodIP = "10.1.2.3"
	cfg.RelayHopAddr = "0.0.0.0:6000"
	cfg.Voice.HopTimeoutSeconds = 5
	cfg.Voice.MaxHopDials = 9
	cfg.Voice.RelayIDKey = "k-0123456789-0123456789-0123456789"

	opts := mediaRelayOptions(cfg, zap.NewNop(), nil)

	t.Run("internal secret", func(t *testing.T) { assert.Equal(t, "internal-1", opts.Secret) })
	t.Run("pod address", func(t *testing.T) { assert.Equal(t, "10.1.2.3", opts.PodIP) })
	t.Run("hop port, read from the hop address", func(t *testing.T) { assert.Equal(t, 6000, opts.HopPort) })
	t.Run("hop timeout", func(t *testing.T) { assert.Equal(t, 5*time.Second, opts.HopTimeout) })
	t.Run("maximum hop dials", func(t *testing.T) { assert.Equal(t, 9, opts.MaxHopDials) })
	t.Run("relay id key", func(t *testing.T) { assert.Equal(t, cfg.Voice.RelayIDKey, opts.IDKey) })
}

// @scenario "The media relay hub is built from the configuration"
func TestMediaRelayOptions_CarryTheRelayLimitsFromTheConfiguration(t *testing.T) {
	cfg := defaultConfig()
	cfg.Voice.PendingTTLSeconds = 11
	cfg.Voice.MaxRelaySeconds = 22
	cfg.Voice.DrainSeconds = 33
	cfg.Voice.MaxMediaRelays = 44
	cfg.Voice.MaxPendingRelaysPerScope = 5
	cfg.Voice.MaxRelaysPerScope = 6

	opts := mediaRelayOptions(cfg, zap.NewNop(), nil)

	t.Run("pending time to live", func(t *testing.T) { assert.Equal(t, 11*time.Second, opts.PendingTTL) })
	t.Run("maximum relay duration", func(t *testing.T) { assert.Equal(t, 22*time.Second, opts.MaxRelayDuration) })
	t.Run("drain budget", func(t *testing.T) { assert.Equal(t, 33*time.Second, opts.DrainBudget) })
	t.Run("maximum relays", func(t *testing.T) { assert.Equal(t, 44, opts.MaxRelays) })
	t.Run("pending per scope", func(t *testing.T) { assert.Equal(t, 5, opts.MaxPendingPerScope) })
	t.Run("relays per scope", func(t *testing.T) { assert.Equal(t, 6, opts.MaxRelaysPerScope) })
}

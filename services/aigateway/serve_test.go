package aigateway

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/config"
)

func observedWarnIfGracefulShutdownTooShort(t *testing.T, cfg Config) *observer.ObservedLogs {
	t.Helper()
	core, logs := observer.New(zapcore.DebugLevel)
	warnIfGracefulShutdownTooShort(zap.New(core), cfg)
	return logs
}

func requireNoWarning(t *testing.T, logs *observer.ObservedLogs) {
	t.Helper()
	entries := logs.FilterMessage("graceful_shutdown_shorter_than_heartbeat_interval").All()
	require.Empty(t, entries, "expected no warning, got: %+v", entries)
}

func requireWarning(t *testing.T, logs *observer.ObservedLogs) observer.LoggedEntry {
	t.Helper()
	entries := logs.FilterMessage("graceful_shutdown_shorter_than_heartbeat_interval").All()
	require.Len(t, entries, 1)
	return entries[0]
}

// @scenario "stock defaults already fail the graceful-vs-heartbeat check"
func TestServe_WarnIfGracefulShutdownTooShort_StockDefaultsWarn(t *testing.T) {
	cfg := defaultConfig()
	// defaultConfig leaves NonStreamingHeartbeatIntervalSeconds at the
	// resolved 45s default and GracefulSeconds at 10 — the exact mismatch
	// this warning exists to catch.
	entry := requireWarning(t, observedWarnIfGracefulShutdownTooShort(t, cfg))

	require.Equal(t, zap.WarnLevel, entry.Level)
	fields := entry.ContextMap()
	require.Equal(t, 10*time.Second, fields["graceful_shutdown_window"])
	require.Equal(t, 45*time.Second, fields["heartbeat_interval"])
}

// @scenario "graceful window at or above the heartbeat interval does not warn"
func TestServe_WarnIfGracefulShutdownTooShort_SufficientGracefulNoWarn(t *testing.T) {
	cfg := defaultConfig()
	cfg.Server.GracefulSeconds = 45 // exactly equal — not "shorter than"
	requireNoWarning(t, observedWarnIfGracefulShutdownTooShort(t, cfg))

	cfg.Server.GracefulSeconds = 120
	requireNoWarning(t, observedWarnIfGracefulShutdownTooShort(t, cfg))
}

// @scenario "disabled heartbeating skips the check entirely"
func TestServe_WarnIfGracefulShutdownTooShort_HeartbeatDisabledNoWarn(t *testing.T) {
	cfg := defaultConfig()
	cfg.Server.GracefulSeconds = 1
	cfg.NonStreamingHeartbeatIntervalSeconds = -1
	requireNoWarning(t, observedWarnIfGracefulShutdownTooShort(t, cfg))
}

// @scenario "an explicit zero-or-negative graceful window skips the check"
func TestServe_WarnIfGracefulShutdownTooShort_GracefulZeroOrNegativeNoWarn(t *testing.T) {
	cfg := defaultConfig()
	cfg.Server.GracefulSeconds = 0
	requireNoWarning(t, observedWarnIfGracefulShutdownTooShort(t, cfg))

	cfg.Server.GracefulSeconds = -5
	requireNoWarning(t, observedWarnIfGracefulShutdownTooShort(t, cfg))
}

// @scenario "an unset heartbeat interval resolves to the default before comparing"
func TestServe_WarnIfGracefulShutdownTooShort_ZeroHeartbeatResolvesToDefault(t *testing.T) {
	cfg := defaultConfig()
	cfg.NonStreamingHeartbeatIntervalSeconds = 0 // explicit zero, same as unset
	cfg.Server.GracefulSeconds = int(config.DefaultNonStreamingHeartbeatInterval/time.Second) - 1
	entry := requireWarning(t, observedWarnIfGracefulShutdownTooShort(t, cfg))
	require.Equal(t, config.DefaultNonStreamingHeartbeatInterval, entry.ContextMap()["heartbeat_interval"])
}

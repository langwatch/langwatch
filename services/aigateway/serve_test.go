package aigateway

import (
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/config"
	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/services/aigateway/adapters/providers"
	"github.com/langwatch/langwatch/services/aigateway/adapters/spendemitter"
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

func requireNoStreamWarning(t *testing.T, logs *observer.ObservedLogs) {
	t.Helper()
	entries := logs.FilterMessage("graceful_shutdown_shorter_than_max_stream_duration").All()
	require.Empty(t, entries, "expected no max-stream warning, got: %+v", entries)
}

func requireStreamWarning(t *testing.T, logs *observer.ObservedLogs) observer.LoggedEntry {
	t.Helper()
	entries := logs.FilterMessage("graceful_shutdown_shorter_than_max_stream_duration").All()
	require.Len(t, entries, 1)
	return entries[0]
}

// @scenario "stock defaults clear the graceful-vs-heartbeat check"
func TestServe_WarnIfGracefulShutdownTooShort_StockDefaultsDoNotWarn(t *testing.T) {
	cfg := defaultConfig()
	// A deployment that takes the defaults must never see either warning,
	// or they are noise rather than a signal that something needs
	// attention. Both bounds are cleared by construction: the graceful
	// window sits above the heartbeat interval and above the longest
	// stream the upstream provider timeout permits.
	require.Greater(t, cfg.Server.GracefulSeconds, int(config.DefaultNonStreamingHeartbeatInterval/time.Second))
	require.GreaterOrEqual(t, cfg.Server.GracefulSeconds, providers.ProviderRequestTimeoutSeconds)
	logs := observedWarnIfGracefulShutdownTooShort(t, cfg)
	requireNoWarning(t, logs)
	requireNoStreamWarning(t, logs)
}

// A streaming response is bounded only by the upstream provider timeout, so
// a graceful window under that ceiling severs long streams on every deploy.
// That is the case the old heartbeat-only check stayed silent for.
//
// @scenario "a graceful window below the upstream stream ceiling warns"
func TestServe_WarnIfGracefulShutdownTooShort_BelowMaxStreamDurationWarns(t *testing.T) {
	cfg := defaultConfig()
	// The old default. Well above the 45s heartbeat interval, so the
	// heartbeat check passes and only the stream check can catch it.
	cfg.Server.GracefulSeconds = 60
	logs := observedWarnIfGracefulShutdownTooShort(t, cfg)
	requireNoWarning(t, logs)

	entry := requireStreamWarning(t, logs)
	require.Equal(t, zap.WarnLevel, entry.Level)
	fields := entry.ContextMap()
	require.Equal(t, 60*time.Second, fields["graceful_shutdown_window"])
	require.Equal(t, providers.ProviderRequestTimeoutSeconds*time.Second, fields["max_stream_duration"])
}

// @scenario "a graceful window at or above the upstream stream ceiling stays quiet"
func TestServe_WarnIfGracefulShutdownTooShort_AtOrAboveMaxStreamDurationNoWarn(t *testing.T) {
	cfg := defaultConfig()

	cfg.Server.GracefulSeconds = providers.ProviderRequestTimeoutSeconds // exactly equal, not "shorter than"
	requireNoStreamWarning(t, observedWarnIfGracefulShutdownTooShort(t, cfg))

	cfg.Server.GracefulSeconds = providers.ProviderRequestTimeoutSeconds + 60
	requireNoStreamWarning(t, observedWarnIfGracefulShutdownTooShort(t, cfg))
}

// Disabling heartbeats says nothing about how long a stream can run, so the
// stream bound still applies.
//
// @scenario "disabled heartbeating still checks the stream ceiling"
func TestServe_WarnIfGracefulShutdownTooShort_HeartbeatDisabledStillChecksStreams(t *testing.T) {
	cfg := defaultConfig()
	cfg.Server.GracefulSeconds = 1
	cfg.NonStreamingHeartbeatIntervalSeconds = -1

	logs := observedWarnIfGracefulShutdownTooShort(t, cfg)
	requireNoWarning(t, logs)
	requireStreamWarning(t, logs)
}

// @scenario "a graceful window narrowed below the heartbeat interval warns"
func TestServe_WarnIfGracefulShutdownTooShort_NarrowedGracefulWarns(t *testing.T) {
	cfg := defaultConfig()
	cfg.Server.GracefulSeconds = 10
	entry := requireWarning(t, observedWarnIfGracefulShutdownTooShort(t, cfg))

	require.Equal(t, zap.WarnLevel, entry.Level)
	fields := entry.ContextMap()
	require.Equal(t, 10*time.Second, fields["graceful_shutdown_window"])
	require.Equal(t, 45*time.Second, fields["heartbeat_interval"])
}

// @scenario "graceful window at or above the heartbeat interval does not warn"
func TestServe_WarnIfGracefulShutdownTooShort_SufficientGracefulNoWarn(t *testing.T) {
	cfg := defaultConfig()
	cfg.Server.GracefulSeconds = 45 // exactly equal, which is not "shorter than"
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

// unstartedServer builds the http.Server that addManagedServices wraps in
// these ordering tests. It is only ever registered, never started, so its
// timeouts never take effect; ReadHeaderTimeout is set because an
// http.Server literal without one is a Slowloris finding.
func unstartedServer() *http.Server {
	return &http.Server{ReadHeaderTimeout: 10 * time.Second}
}

// Stop runs in reverse registration order, so the listener has to be
// registered after the spend services to be drained before them. Getting
// this backwards silently loses money: Spool.Append counts and discards
// every record handed to it after Close, so closing the spool first throws
// away the spend of every request that completes during the drain.
//
// @scenario "the listener drains before the spend spool and drainer"
func TestServe_ManagedServices_DrainTheListenerBeforeTheSpendPipeline(t *testing.T) {
	spool, err := spendemitter.Open(spendemitter.SpoolOptions{Dir: t.TempDir(), PodID: "test-pod"})
	require.NoError(t, err)
	t.Cleanup(func() { _ = spool.Close() })

	g := lifecycle.New()
	addManagedServices(g, &Deps{
		SpendSpool:   spool,
		SpendDrainer: spendemitter.NewDrainer(spendemitter.DrainerOptions{Spool: spool}),
	}, ownServices{HTTP: unstartedServer()})

	started := g.ServiceNames()
	require.Contains(t, started, "http")
	require.Contains(t, started, "spend-spool")
	require.Contains(t, started, "spend-drainer")

	// Stop order is the reverse of start order.
	stopped := slices.Clone(started)
	slices.Reverse(stopped)

	httpAt := slices.Index(stopped, "http")
	drainerAt := slices.Index(stopped, "spend-drainer")
	spoolAt := slices.Index(stopped, "spend-spool")

	require.Less(t, httpAt, drainerAt,
		"the listener must drain before the spend drainer stops, stop order was %v", stopped)
	require.Less(t, httpAt, spoolAt,
		"the listener must drain before the spend spool closes, stop order was %v", stopped)
	require.Less(t, drainerAt, spoolAt,
		"the drainer must stop before the spool it reads from closes, stop order was %v", stopped)

	// Telemetry is registered first so it tears down last and the shutdown
	// itself is still traced.
	require.Equal(t, "otel", stopped[len(stopped)-1], "stop order was %v", stopped)
}

// @scenario "an absent spend pipeline still leaves the listener draining first"
func TestServe_ManagedServices_ListenerDrainsFirstWithoutSpend(t *testing.T) {
	g := lifecycle.New()
	addManagedServices(g, &Deps{}, ownServices{HTTP: unstartedServer()})

	started := g.ServiceNames()
	require.NotContains(t, started, "spend-spool")
	require.NotContains(t, started, "spend-drainer")
	require.Equal(t, "http", started[len(started)-1],
		"the listener must be registered last so it is stopped first, start order was %v", started)
}

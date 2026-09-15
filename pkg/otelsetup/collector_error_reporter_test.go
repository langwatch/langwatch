package otelsetup

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

// unflushableMeterProvider exports to a port nothing listens on, which is what
// a developer with OTEL_EXPORTER_OTLP_ENDPOINT set and no collector running
// has. Its shutdown flush always fails.
func unflushableMeterProvider(t *testing.T) *sdkmetric.MeterProvider {
	t.Helper()
	exporter, err := otlpmetrichttp.New(
		t.Context(),
		otlpmetrichttp.WithEndpointURL("http://localhost:1/v1/metrics"),
	)
	require.NoError(t, err)
	return sdkmetric.NewMeterProvider(sdkmetric.WithReader(sdkmetric.NewPeriodicReader(exporter)))
}

// refused is the shape an OTLP exporter phrases a collector that is not
// running: a quoted endpoint, then the transport's own reason.
func refused(endpoint string) error {
	return errors.New(`Post "` + endpoint + `": dial tcp 127.0.0.1:4318: connect: connection refused`)
}

func reporterWithLog(t *testing.T) (*collectorErrorReporter, *observer.ObservedLogs) {
	t.Helper()
	core, recorded := observer.New(zapcore.DebugLevel)
	return newCollectorErrorReporter(zap.New(core)), recorded
}

// Corresponds to specs/setup/dev-stack-boot-noise.feature.
/** @scenario "An unreachable collector is reported once and then left alone" */
func TestCollectorErrorReporter_SaysAnUnreachableCollectorOnce(t *testing.T) {
	reporter, recorded := reporterWithLog(t)

	for range 50 {
		reporter.Handle(refused("http://localhost:4318/v1/logs"))
	}

	lines := recorded.All()
	require.Len(t, lines, 2, "one report and one notice that it is going quiet")
	assert.Equal(t, "otel collector unreachable", lines[0].Message)
	assert.Equal(t, "http://localhost:4318/v1/logs", lines[0].ContextMap()["endpoint"])
	assert.Equal(t,
		"suppressing further export errors until the collector answers",
		lines[1].Message,
	)
}

/** @scenario "An unreachable collector is reported once and then left alone" */
func TestCollectorErrorReporter_SaysEachEndpointSeparately(t *testing.T) {
	reporter, recorded := reporterWithLog(t)

	// A service can be exporting to two, and one being down says nothing about
	// the other.
	reporter.Handle(refused("http://localhost:4318/v1/logs"))
	reporter.Handle(refused("http://localhost:4318/v1/traces"))
	reporter.Handle(refused("http://localhost:4318/v1/logs"))

	assert.Equal(t, 4, recorded.Len(), "two reports, each with its own notice")
}

/** @scenario "A collector that starts answering is reported on again if it stops" */
func TestCollectorErrorReporter_ReportsAgainAfterTheCollectorAnswered(t *testing.T) {
	reporter, recorded := reporterWithLog(t)

	reporter.Handle(refused("http://localhost:4318/v1/logs"))
	reporter.Handle(refused("http://localhost:4318/v1/logs"))
	require.Equal(t, 2, recorded.Len())

	reporter.exported()
	reporter.Handle(refused("http://localhost:4318/v1/logs"))

	assert.Equal(t, 4, recorded.Len(), "the collector answered, so this is news again")
}

// A failure that is not about reaching a collector is not deduplicated: it is
// not the same fact repeating, and something new is wrong each time.
/** @scenario "Export failures are reported the way every other line is" */
func TestCollectorErrorReporter_DoesNotSuppressOtherFailures(t *testing.T) {
	reporter, recorded := reporterWithLog(t)

	reporter.Handle(errors.New("partial success: 3 spans rejected"))
	reporter.Handle(errors.New("partial success: 3 spans rejected"))

	assert.Equal(t, 2, recorded.Len())
	assert.Equal(t, "otel export failed", recorded.All()[0].Message)
}

/** @scenario "Export failures are reported the way every other line is" */
func TestCollectorErrorReporter_WritesThroughTheServiceLogger(t *testing.T) {
	reporter, recorded := reporterWithLog(t)

	reporter.Handle(refused("http://localhost:4318/v1/logs"))

	// Nothing reaches the standard logger, which is where these used to go and
	// is the only line shape in a `pnpm dev` terminal with a date on it.
	require.NotZero(t, recorded.Len())
	assert.Equal(t, zapcore.WarnLevel, recorded.All()[0].Level)
}

/** @scenario "A flush that could not reach the collector is not a failed run" */
func TestProviderShutdown_ReportsAFailedFlushWithoutFailingTheRun(t *testing.T) {
	core, recorded := observer.New(zapcore.DebugLevel)
	provider := &Provider{logger: zap.New(core), mp: unflushableMeterProvider(t)}

	err := provider.Shutdown(t.Context())

	require.NoError(t, err, "a clean shutdown must not read as a crash")
	require.Equal(t, 1, recorded.Len())
	assert.Equal(t, "otel telemetry was not flushed at shutdown", recorded.All()[0].Message)
	assert.Equal(t, zapcore.WarnLevel, recorded.All()[0].Level)
}

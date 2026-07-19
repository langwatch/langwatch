package clog

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	prettyconsole "github.com/thessem/zap-prettyconsole"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/langwatch/langwatch/pkg/contexts"
)

func TestSetGet_Roundtrip(t *testing.T) {
	logger := zap.NewNop()
	ctx := Set(context.Background(), logger)

	got := Get(ctx)
	assert.Same(t, logger, got)
}

func TestGet_Fallback(t *testing.T) {
	logger := Get(context.Background())

	require.NotNil(t, logger, "fallback logger should not be nil")
}

func TestNew_Debug(t *testing.T) {
	logger := New(context.Background(), Config{Level: "debug"})

	require.NotNil(t, logger)
	assert.True(t, logger.Core().Enabled(zap.DebugLevel))
}

func TestNew_Production(t *testing.T) {
	logger := New(context.Background(), Config{Level: "info"})

	require.NotNil(t, logger)
	assert.False(t, logger.Core().Enabled(zap.DebugLevel))
}

func TestNew_StampsServiceInfo(t *testing.T) {
	info := contexts.ServiceInfo{
		Environment: "production",
		Service:     "aigateway",
		Version:     "v2.0.0",
	}
	ctx := contexts.SetServiceInfo(context.Background(), info)

	logger := New(ctx, Config{Level: "info"})

	require.NotNil(t, logger)
	// The returned logger should differ from a bare one (fields were added).
	bare := New(context.Background(), Config{Level: "info"})
	assert.NotSame(t, bare, logger)
}

// The pretty console is read by a human in a haven terminal that interleaves
// this lane with the TS app's pino-pretty lane, so the two formats have to
// agree. pino-pretty writes:
//
//	[12:19:00.616] INFO (langwatch:api): message key=value
//
// These pin the Go half of that; the JS half is prettyConsoleOptions in
// langwatch/packages/observability/src/logger.ts.
func TestPrettyEncoder_MatchesPinoPrettyPrefix(t *testing.T) {
	enc := prettyconsole.NewEncoder(prettyEncoderConfig())
	entry := zapcore.Entry{
		Level:      zapcore.WarnLevel,
		Time:       time.Date(2026, 7, 15, 14, 9, 5, 616_000_000, time.UTC),
		LoggerName: "langwatch:gateway",
		Message:    "disk filling up",
	}

	buf, err := enc.EncodeEntry(entry, nil)
	require.NoError(t, err)
	line := stripANSI(buf.String())

	// A 24h wall-clock timestamp with milliseconds, bracketed — prettyconsole's
	// own default is an unbracketed 12h clock with no seconds.
	assert.Contains(t, line, "[14:09:05.616]")
	// The level, spelled out in full. Whether a line is a warning is the first
	// thing anyone scans for, and "WRN" (prettyconsole's default) does not match
	// what the JS lane prints two lines above it.
	assert.Contains(t, line, "WARN")
	// The logger name, parenthesised like pino's "(name)".
	assert.Contains(t, line, "(langwatch:gateway)")
	assert.Contains(t, line, "disk filling up")
}

func TestPrettyEncoder_UnnamedLoggerHasNoEmptyParens(t *testing.T) {
	enc := prettyconsole.NewEncoder(prettyEncoderConfig())
	entry := zapcore.Entry{
		Level:   zapcore.InfoLevel,
		Time:    time.Date(2026, 7, 15, 14, 9, 5, 0, time.UTC),
		Message: "listening",
	}

	buf, err := enc.EncodeEntry(entry, nil)
	require.NoError(t, err)

	assert.NotContains(t, stripANSI(buf.String()), "()")
}

// stripANSI removes the colour escapes prettyconsole writes, so assertions read
// against the text a human sees rather than the bytes a terminal consumes.
func stripANSI(s string) string {
	return ansiEscape.ReplaceAllString(s, "")
}

var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;]*m`)

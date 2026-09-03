package clog

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/langwatch/langwatch/pkg/contexts"
)

// ansi matches every color escape, so the assertions below are about the shape
// of a line and not about how it is painted.
var ansi = regexp.MustCompile("\x1b\\[[0-9;]*m")

// renderedLine encodes one entry the way the pretty console does and returns
// it with the color stripped.
func renderedLine(t *testing.T, level zapcore.Level, message string, fields ...zapcore.Field) string {
	t.Helper()
	encoded, err := prettyConsoleEncoder().EncodeEntry(zapcore.Entry{
		Level:   level,
		Message: message,
	}, fields)
	require.NoError(t, err)
	return strings.TrimRight(ansi.ReplaceAllString(encoded.String(), ""), "\n")
}

// TestPrettyConsole_LineShape pins the one shape every lane in a `pnpm dev`
// terminal prints. Corresponds to specs/setup/dev-stack-log-format.feature.
//
/** @scenario "A Go service prints the same shape as the Node lanes" */
func TestPrettyConsole_LineShape(t *testing.T) {
	line := renderedLine(t, zapcore.InfoLevel, "control plane unreachable",
		zap.String("endpoint", "http://localhost:6560"),
		zap.Int("attempt", 3),
	)

	assert.Regexp(t,
		`^\[\d{2}:\d{2}:\d{2}\.\d{3}\] INFO control plane unreachable attempt=3 endpoint=http://localhost:6560$`,
		line,
	)
}

// TestPrettyConsole_NoMessageMarker pins the removal of the "> " prettyconsole
// writes between the level and the message — nothing else in the terminal
// writes one.
//
/** @scenario "A Go service prints the same shape as the Node lanes" */
func TestPrettyConsole_NoMessageMarker(t *testing.T) {
	line := renderedLine(t, zapcore.WarnLevel, "otel export error")

	assert.NotContains(t, line, ">")
	assert.Equal(t, "otel export error", strings.SplitN(line, "WARN ", 2)[1])
}

// TestPrettyConsole_LevelIsAWholeWord pins the level rendering: the same whole
// capital word the Node lanes print, not zap's three-letter default.
//
/** @scenario "A Go service prints the same shape as the Node lanes" */
func TestPrettyConsole_LevelIsAWholeWord(t *testing.T) {
	for level, word := range map[zapcore.Level]string{
		zapcore.DebugLevel: "DEBUG",
		zapcore.InfoLevel:  "INFO",
		zapcore.WarnLevel:  "WARN",
		zapcore.ErrorLevel: "ERROR",
	} {
		assert.Contains(t, renderedLine(t, level, "worded"), "] "+word+" worded")
	}
}

// TestPrettyConsole_OmitsConstantIdentity pins that the console does not repeat
// the service identity on every line — `concurrently` has already said which
// lane a line came from.
//
/** @scenario "The constant service identity is not repeated on every line" */
func TestPrettyConsole_OmitsConstantIdentity(t *testing.T) {
	ctx := contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{
		Service:     "langwatch-service-aigateway",
		Version:     "dev",
		Environment: "local",
	})

	assert.Nil(t, consoleServiceFields(ctx, "pretty"))
	assert.NotNil(t, consoleServiceFields(ctx, "json"))
}

// TestPrettyConsole_JSONKeepsIdentity pins the other half: nothing prefixes a
// machine-readable line, so there the identity is the only thing saying which
// service wrote it.
//
/** @scenario "The constant service identity is not repeated on every line" */
func TestPrettyConsole_JSONKeepsIdentity(t *testing.T) {
	ctx := contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{
		Service:     "langwatch-service-nlp",
		Version:     "dev",
		Environment: "local",
	})

	fields := consoleServiceFields(ctx, "json")

	require.Len(t, fields, 3)
	assert.Equal(t, "service", fields[0].Key)
}

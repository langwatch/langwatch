package clog

import (
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Every LangWatch process writes the same structured JSON on stdout, in every
// environment — dev/docs/best_practices/dev-log-format.md. This pins the Go
// half of that vocabulary: `time` (RFC 3339 with milliseconds), `level`
// (lowercase word), `msg`, `service`. The renderers
// (tools/thuishaven/domain/logfmt, dev/scripts/log-render.mjs) parse exactly
// these fields.

// rfc3339Millis is the instant format both renderers read.
var rfc3339Millis = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$`)

// encodeOne runs one entry through the shared JSON encoder, which is what a Go
// service actually writes to stdout.
func encodeOne(t *testing.T, entry zapcore.Entry, fields ...zapcore.Field) map[string]any {
	t.Helper()
	buffer, err := jsonEncoder().EncodeEntry(entry, fields)
	require.NoError(t, err)
	var record map[string]any
	require.NoError(t, json.Unmarshal(buffer.Bytes(), &record))
	return record
}

func TestJSONEncoderWritesTheSharedFieldVocabulary(t *testing.T) {
	record := encodeOne(t,
		zapcore.Entry{Level: zapcore.InfoLevel, Time: mustTime(t), Message: "listening"},
		zap.String("service", "langwatch-service-nlpgo"),
		zap.Int("port", 5561),
	)

	assert.Equal(t, "info", record["level"], "level is the lowercase word both renderers parse")
	assert.Equal(t, "listening", record["msg"])
	assert.Equal(t, "langwatch-service-nlpgo", record["service"])
	assert.EqualValues(t, 5561, record["port"])

	timestamp, ok := record["time"].(string)
	require.True(t, ok, "time must be a string, not zap's epoch float: %#v", record)
	assert.Regexp(t, rfc3339Millis, timestamp)
	assert.NotContains(t, record, "ts", "the epoch-float key must be gone, not doubled up")
}

func TestJSONEncoderWritesLowercaseLevels(t *testing.T) {
	for _, level := range []zapcore.Level{
		zapcore.DebugLevel, zapcore.InfoLevel, zapcore.WarnLevel, zapcore.ErrorLevel,
	} {
		record := encodeOne(t, zapcore.Entry{Level: level, Time: mustTime(t), Message: "x"})
		assert.Equal(t, level.String(), record["level"])
	}
}

// TestUnconfiguredFormatIsTheSharedOne pins the default: an unset LOG_FORMAT
// selects JSON, not a pretty console, so a service nobody configured still
// emits something the renderers can read.
func TestUnconfiguredFormatIsTheSharedOne(t *testing.T) {
	require.NoError(t, Config{}.Validate())
	assert.NotEqual(t, "pretty", Config{}.Format)
	assert.Equal(t, "time", jsonEncoderConfig().TimeKey)
	assert.Equal(t, "msg", jsonEncoderConfig().MessageKey)
	assert.Equal(t, "level", jsonEncoderConfig().LevelKey)
}

func mustTime(t *testing.T) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339Nano, "2026-09-07T11:10:46.108Z")
	require.NoError(t, err)
	return parsed
}

package dispatch

import (
	"log/slog"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
)

// bifrostLogger bridges bifrost's Logger interface onto our slog setup so
// both sides emit one coherent JSON log stream.
type bifrostLogger struct{ l *slog.Logger }

func newBifrostLogger(l *slog.Logger) bfschemas.Logger {
	return &bifrostLogger{l: l.With("component", "bifrost")}
}

func (b *bifrostLogger) Debug(msg string, args ...any) { b.l.Debug(msg, args...) }
func (b *bifrostLogger) Info(msg string, args ...any)  { b.l.Info(msg, args...) }
func (b *bifrostLogger) Warn(msg string, args ...any)  { b.l.Warn(msg, args...) }
func (b *bifrostLogger) Error(msg string, args ...any) { b.l.Error(msg, args...) }
func (b *bifrostLogger) Fatal(msg string, args ...any) { b.l.Error(msg, args...) }

func (b *bifrostLogger) SetLevel(_ bfschemas.LogLevel)            {} // slog owned by us
func (b *bifrostLogger) SetOutputType(_ bfschemas.LoggerOutputType) {}
func (b *bifrostLogger) GetLevel() bfschemas.LogLevel              { return bfschemas.LogLevelInfo }

// LogHTTPRequest returns a no-op builder — our own httpx.AccessLog
// middleware already emits access logs. Bifrost never issues HTTP
// directly in our embed, so this path is cold anyway.
func (b *bifrostLogger) LogHTTPRequest(_ bfschemas.LogLevel, _ string) bfschemas.LogEventBuilder {
	return bfschemas.NoopLogEvent
}

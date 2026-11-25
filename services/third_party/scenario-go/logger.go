package scenario

import (
	"io"
	"log/slog"
	"os"
	"strings"
	"sync/atomic"
)

var sdkLogger atomic.Pointer[slog.Logger]

// logger returns the SDK logger, created on first use. SCENARIO_LOG_LEVEL
// (or LOG_LEVEL) selects debug, info, warn, error or off; the default is
// warn so tests stay quiet. SetLogger replaces it.
func logger() *slog.Logger {
	if l := sdkLogger.Load(); l != nil {
		return l
	}
	sdkLogger.CompareAndSwap(nil, newDefaultLogger())
	return sdkLogger.Load()
}

func newDefaultLogger() *slog.Logger {
	level := os.Getenv("SCENARIO_LOG_LEVEL")
	if level == "" {
		level = os.Getenv("LOG_LEVEL")
	}
	var lv slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lv = slog.LevelDebug
	case "info":
		lv = slog.LevelInfo
	case "error":
		lv = slog.LevelError
	case "off", "none", "silent":
		return slog.New(slog.NewTextHandler(io.Discard, nil))
	default:
		lv = slog.LevelWarn
	}
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: lv})).With("sdk", "scenario")
}

// SetLogger replaces the SDK logger.
func SetLogger(l *slog.Logger) { sdkLogger.Store(l) }

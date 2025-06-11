package openai

import (
	"io"
	"log/slog"
)

// Default logger that discards all logs (zero-noise default)
// This ensures importing the package never spams stdout/stderr
var defaultLogger = slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{
	Level: slog.LevelError, // Only log errors by default, even when not discarded
}))

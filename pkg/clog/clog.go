package clog

import (
	"context"
	"fmt"
	"os"
	"sync"

	prettyconsole "github.com/thessem/zap-prettyconsole"
	"go.opentelemetry.io/contrib/bridges/otelzap"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/langwatch/langwatch/pkg/contexts"
)

// otelScopeName is the instrumentation scope stamped on log records the
// otelzap bridge ships to the collector.
const otelScopeName = "github.com/langwatch/langwatch/pkg/clog"

type contextKey struct{}

// fallbackLogger is the process-global logger returned by Get when a context
// carries none. Built once under fallbackOnce so a bare ctx reaching Get on a
// hot path doesn't construct a fresh production logger on every call.
var (
	fallbackOnce   sync.Once
	fallbackLogger *zap.Logger
)

// Set stores a zap logger in the context.
func Set(ctx context.Context, logger *zap.Logger) context.Context {
	return context.WithValue(ctx, contextKey{}, logger)
}

// Get retrieves the zap logger from context, falling back to a global production logger.
func Get(ctx context.Context) *zap.Logger {
	if l, ok := ctx.Value(contextKey{}).(*zap.Logger); ok && l != nil {
		return l
	}
	fallbackOnce.Do(func() {
		fallbackLogger, _ = zap.NewProduction()
	})
	return fallbackLogger
}

// With returns a child logger with additional fields, stored back into context.
func With(ctx context.Context, fields ...zap.Field) context.Context {
	return Set(ctx, Get(ctx).With(fields...))
}

// New creates a configured zap logger for a service.
// If the context carries ServiceInfo, service/version/env fields are stamped
// on every log line automatically.
func New(ctx context.Context, cfg Config) *zap.Logger {
	var logger *zap.Logger

	if cfg.Format == "pretty" {
		logger = zap.New(zapcore.NewCore(
			prettyconsole.NewEncoder(prettyEncoderConfig()),
			zapcore.Lock(os.Stdout),
			cfg.zapLevel(),
		))
	} else {
		zapCfg := zap.NewProductionConfig()
		zapCfg.Level = zap.NewAtomicLevelAt(cfg.zapLevel())
		logger, _ = zapCfg.Build()
	}

	if fields := serviceFields(ctx); fields != nil {
		logger = logger.With(fields...)
	}
	return logger
}

// serviceFields stamps service/version/env from the context's ServiceInfo, so
// New and WithCollector attach the same base fields.
func serviceFields(ctx context.Context) []zap.Field {
	info := contexts.GetServiceInfo(ctx)
	if info == nil {
		return nil
	}
	return []zap.Field{
		zap.String("service", info.Service),
		zap.String("version", info.Version),
		zap.String("env", info.Environment),
	}
}

// WithCollector wires the OTLP debug collector into logging when lp is non-nil
// (local dev). It splits the stream: the console core is gated at
// cfg.ConsoleLevel (e.g. "warn" — a quiet terminal) and an otelzap core is
// gated at cfg.OTelLevel (e.g. "debug" — full detail), so info/debug flow to the
// collector while only warnings/errors reach the console. zapcore.NewTee keeps
// stdout writing alongside the collector. When lp is nil (prod), the base logger
// from New is returned untouched — no split, no collector, no behavior change.
//
// The two cores carry independent LevelEnablers, so a Debug entry is still
// created and delivered to the otel core even though the console core rejects it.
//
// base is only consulted for the lp == nil case above — when lp != nil, a
// fresh logger is built and only serviceFields(ctx) is reapplied, so any
// fields a caller attached to base after New() are silently lost. Call this
// immediately after New, before attaching any extra fields.
func WithCollector(ctx context.Context, cfg Config, base *zap.Logger, lp *sdklog.LoggerProvider) *zap.Logger {
	if lp == nil {
		return base
	}
	consoleCore := buildConsoleCore(cfg.Format, cfg.consoleZapLevel())
	otelCore := newLeveledCore(
		otelzap.NewCore(otelScopeName, otelzap.WithLoggerProvider(lp)),
		cfg.otelZapLevel(),
	)
	// zap.New starts from a bare logger, so the caller/stacktrace annotation the
	// New path gets from zap.NewProductionConfig has to be re-applied here or the
	// split stream would silently lose it.
	logger := zap.New(
		zapcore.NewTee(consoleCore, otelCore),
		zap.AddCaller(),
		zap.AddStacktrace(zapcore.ErrorLevel),
	)
	if fields := serviceFields(ctx); fields != nil {
		logger = logger.With(fields...)
	}
	return logger
}

// buildConsoleCore builds the stdout core at an explicit level, matching New's
// formatting (prettyconsole for "pretty", JSON otherwise).
func buildConsoleCore(format string, level zapcore.Level) zapcore.Core {
	out := zapcore.Lock(os.Stdout)
	if format == "pretty" {
		return zapcore.NewCore(prettyconsole.NewEncoder(prettyEncoderConfig()), out, level)
	}
	return zapcore.NewCore(zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()), out, level)
}

// prettyEncoderConfig aligns the Go pretty console with the TS app's
// pino-pretty lane, so a terminal interleaving Go and JS services reads as one
// format: a 24h HH:MM:SS.mmm timestamp (prettyconsole's default is 12h with no
// seconds) and a full-word capital level (INFO, not INF) — matching
// pino-pretty's "[12:19:00.616] INFO (name): msg".
func prettyEncoderConfig() zapcore.EncoderConfig {
	cfg := prettyconsole.NewEncoderConfig()
	cfg.EncodeTime = prettyconsole.DefaultTimeEncoder("15:04:05.000")
	cfg.EncodeLevel = zapcore.CapitalColorLevelEncoder
	return cfg
}

// leveledCore gates an inner core to a minimum level. Used to hold the otelzap
// bridge (which exposes no level option) at OTelLevel, independent of the
// console core's level.
type leveledCore struct {
	zapcore.Core
	enab zapcore.LevelEnabler
}

func newLeveledCore(inner zapcore.Core, enab zapcore.LevelEnabler) zapcore.Core {
	return &leveledCore{Core: inner, enab: enab}
}

func (c *leveledCore) Enabled(l zapcore.Level) bool { return c.enab.Enabled(l) }

func (c *leveledCore) Check(e zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	// Standard level-filter pattern: gate on our level, then delegate to the
	// wrapped core's own Check so it registers itself for the write.
	if c.enab.Enabled(e.Level) {
		return c.Core.Check(e, ce)
	}
	return ce
}

func (c *leveledCore) With(fields []zapcore.Field) zapcore.Core {
	return &leveledCore{Core: c.Core.With(fields), enab: c.enab}
}

// Config controls logging setup. The env keys are shared with the TS app
// (LOG_LEVEL / LOG_CONSOLE_LEVEL / LOG_OTEL_LEVEL) so one set of variables in
// langwatch/.env configures logging for both Go and JS.
type Config struct {
	Level  string `env:"LEVEL"`  // "debug", "info", "warn", "error"
	Format string `env:"FORMAT"` // "json" (default), "pretty"

	// ConsoleLevel / OTelLevel split the stream when the local observability
	// collector is enabled (see WithCollector): the console shows only
	// ConsoleLevel+ (e.g. "warn" — a quiet terminal) while OTelLevel+ (e.g.
	// "debug" — full detail) ships to the collector. Empty ConsoleLevel falls
	// back to Level; empty OTelLevel defaults to debug. Ignored without the
	// collector (New leaves prod behavior unchanged).
	ConsoleLevel string `env:"CONSOLE_LEVEL"`
	OTelLevel    string `env:"OTEL_LEVEL"`
}

func (c Config) consoleZapLevel() zapcore.Level {
	if c.ConsoleLevel != "" {
		var lvl zapcore.Level
		if lvl.UnmarshalText([]byte(c.ConsoleLevel)) == nil {
			return lvl
		}
	}
	return c.zapLevel()
}

func (c Config) otelZapLevel() zapcore.Level {
	if c.OTelLevel != "" {
		var lvl zapcore.Level
		if lvl.UnmarshalText([]byte(c.OTelLevel)) == nil {
			return lvl
		}
	}
	return zapcore.DebugLevel
}

// Validate checks that config values are recognized.
func (c Config) Validate() error {
	switch c.Format {
	case "", "json", "pretty":
	default:
		return fmt.Errorf("clog: unknown LOG_FORMAT %q (want json or pretty)", c.Format)
	}

	if c.Level != "" {
		var lvl zap.AtomicLevel
		if err := lvl.UnmarshalText([]byte(c.Level)); err != nil {
			return fmt.Errorf("clog: unknown LOG_LEVEL %q: %w", c.Level, err)
		}
	}

	if c.ConsoleLevel != "" {
		var lvl zapcore.Level
		if err := lvl.UnmarshalText([]byte(c.ConsoleLevel)); err != nil {
			return fmt.Errorf("clog: unknown LOG_CONSOLE_LEVEL %q: %w", c.ConsoleLevel, err)
		}
	}
	if c.OTelLevel != "" {
		var lvl zapcore.Level
		if err := lvl.UnmarshalText([]byte(c.OTelLevel)); err != nil {
			return fmt.Errorf("clog: unknown LOG_OTEL_LEVEL %q: %w", c.OTelLevel, err)
		}
	}

	return nil
}

func (c Config) zapLevel() zapcore.Level {
	if c.Level == "" {
		return zapcore.InfoLevel
	}
	var lvl zapcore.Level
	_ = lvl.UnmarshalText([]byte(c.Level))
	return lvl
}

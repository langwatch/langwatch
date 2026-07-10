package clog

import (
	"context"
	"fmt"

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

// Set stores a zap logger in the context.
func Set(ctx context.Context, logger *zap.Logger) context.Context {
	return context.WithValue(ctx, contextKey{}, logger)
}

// Get retrieves the zap logger from context, falling back to a global production logger.
func Get(ctx context.Context) *zap.Logger {
	if l, ok := ctx.Value(contextKey{}).(*zap.Logger); ok && l != nil {
		return l
	}
	l, _ := zap.NewProduction()
	return l
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
		logger = prettyconsole.NewLogger(cfg.zapLevel())
	} else {
		zapCfg := zap.NewProductionConfig()
		zapCfg.Level = zap.NewAtomicLevelAt(cfg.zapLevel())
		logger, _ = zapCfg.Build()
	}

	if info := contexts.GetServiceInfo(ctx); info != nil {
		logger = logger.With(
			zap.String("service", info.Service),
			zap.String("version", info.Version),
			zap.String("env", info.Environment),
		)
	}
	return logger
}

// WithCollector tees an existing zap logger so its records ALSO ship to
// the OTLP debug collector via the official otelzap bridge, while the
// original console/pretty/json core keeps writing to stdout unchanged
// (zapcore.NewTee). Returns the logger untouched when lp is nil (the
// debug collector is disabled), so callers can wire it unconditionally.
//
// Wrapping the built logger — rather than constructing the tee inside
// New — keeps New's signature stable for every existing caller and lets
// deps.go apply the tee only after the LoggerProvider exists (the
// provider is built after the logger during service bootstrap).
func WithCollector(logger *zap.Logger, lp *sdklog.LoggerProvider) *zap.Logger {
	if lp == nil {
		return logger
	}
	otelCore := otelzap.NewCore(otelScopeName, otelzap.WithLoggerProvider(lp))
	return logger.WithOptions(zap.WrapCore(func(existing zapcore.Core) zapcore.Core {
		return zapcore.NewTee(existing, otelCore)
	}))
}

// Config controls logging setup.
type Config struct {
	Level  string `env:"LEVEL"`  // "debug", "info", "warn", "error"
	Format string `env:"FORMAT"` // "json" (default), "pretty"
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

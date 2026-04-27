package clog

import (
	"context"
	"fmt"

	prettyconsole "github.com/thessem/zap-prettyconsole"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/langwatch/langwatch/pkg/contexts"
)

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

package clog

import (
	"context"

	"go.uber.org/zap"

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
func New(cfg Config) *zap.Logger {
	var zapCfg zap.Config
	if cfg.Debug {
		zapCfg = zap.NewDevelopmentConfig()
	} else {
		zapCfg = zap.NewProductionConfig()
	}

	if cfg.Level != "" {
		var level zap.AtomicLevel
		if err := level.UnmarshalText([]byte(cfg.Level)); err == nil {
			zapCfg.Level = level
		}
	}

	logger, _ := zapCfg.Build()
	return logger
}

// Config controls logging setup.
type Config struct {
	Debug bool
	Level string // "debug", "info", "warn", "error"
}

// ForService returns a logger tagged with service info from context.
func ForService(ctx context.Context, logger *zap.Logger) *zap.Logger {
	if info := contexts.GetServiceInfo(ctx); info != nil {
		logger = logger.With(
			zap.String("service", info.Service),
			zap.String("version", info.Version),
			zap.String("environment", info.Environment),
		)
	}
	return logger
}

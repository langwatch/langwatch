package clog

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

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
	logger := New(Config{Debug: true})

	require.NotNil(t, logger)
	// Development loggers enable debug level by default.
	assert.True(t, logger.Core().Enabled(zap.DebugLevel))
}

func TestNew_Production(t *testing.T) {
	logger := New(Config{Debug: false})

	require.NotNil(t, logger)
	// Production loggers disable debug level by default.
	assert.False(t, logger.Core().Enabled(zap.DebugLevel))
}

func TestForService(t *testing.T) {
	info := contexts.ServiceInfo{
		Environment: "staging",
		Service:     "gateway",
		Version:     "v1.0.0",
	}
	ctx := contexts.SetServiceInfo(context.Background(), info)
	base := zap.NewNop()

	logger := ForService(ctx, base)

	require.NotNil(t, logger)
	// ForService should return a different logger instance with added fields.
	assert.NotSame(t, base, logger)
}

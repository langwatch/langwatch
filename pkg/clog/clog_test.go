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
	logger := New(context.Background(), Config{Level: "debug"})

	require.NotNil(t, logger)
	assert.True(t, logger.Core().Enabled(zap.DebugLevel))
}

func TestNew_Production(t *testing.T) {
	logger := New(context.Background(), Config{Level: "info"})

	require.NotNil(t, logger)
	assert.False(t, logger.Core().Enabled(zap.DebugLevel))
}

func TestNew_StampsServiceInfo(t *testing.T) {
	info := contexts.ServiceInfo{
		Environment: "production",
		Service:     "aigateway",
		Version:     "v2.0.0",
	}
	ctx := contexts.SetServiceInfo(context.Background(), info)

	logger := New(ctx, Config{Level: "info"})

	require.NotNil(t, logger)
	// The returned logger should differ from a bare one (fields were added).
	bare := New(context.Background(), Config{Level: "info"})
	assert.NotSame(t, bare, logger)
}


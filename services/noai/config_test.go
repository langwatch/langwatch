package noai

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadConfigDefaults(t *testing.T) {
	t.Setenv("NOAI_SERVER_ADDR", "")
	t.Setenv("NOAI_SERVER_GRACEFUL_SECONDS", "")
	t.Setenv("NOAI_SERVER_MAX_REQUEST_BODY_BYTES", "")

	cfg, err := LoadConfig(context.Background())
	require.NoError(t, err)

	assert.Equal(t, ":5977", cfg.Server.Addr)
	assert.Greater(t, cfg.Server.GracefulSeconds, 0)
	assert.Equal(t, int64(4*1024*1024), cfg.Server.MaxRequestBodyBytes)
}

// Package noai is the LangWatch fake / no-AI service: a deterministic
// OpenAI-compatible echo server used for local development, testing, and
// CI. It speaks /v1/chat/completions and /v1/responses and never reaches
// out to any real provider.
package noai

import (
	"context"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/config"
)

// Config is the top-level configuration for the noai service. Server
// and Log fields read NOAI_-prefixed env vars (NOAI_SERVER_*, NOAI_LOG_*).
// Environment intentionally reads the shared `ENVIRONMENT` var so noai
// picks up the same value as every other service in the mono-binary.
type Config struct {
	Environment string        `env:"ENVIRONMENT"`
	Server      config.Server `env:"NOAI_SERVER"`
	Log         clog.Config   `env:"NOAI_LOG"`
}

// LoadConfig hydrates Config from environment variables. The server
// address falls back to ":5577" — the convention reserved for the noai
// service in dev compose.
func LoadConfig(_ context.Context) (Config, error) {
	cfg := Config{}
	if err := config.Hydrate(&cfg); err != nil {
		return Config{}, err
	}
	if cfg.Server.Addr == "" {
		cfg.Server.Addr = ":5577"
	}
	if cfg.Server.GracefulSeconds == 0 {
		cfg.Server.GracefulSeconds = config.DefaultGracefulSeconds
	}
	if cfg.Server.MaxRequestBodyBytes == 0 {
		cfg.Server.MaxRequestBodyBytes = config.DefaultMaxRequestBodyBytes
	}
	return cfg, nil
}

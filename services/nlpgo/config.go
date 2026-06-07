// Package nlpgo is the LangWatch Go NLP service and the sole NLP engine.
// It is the container entrypoint and owns the /go/* surface (studio
// execution, the playground proxy) plus health. There is no Python
// service; the only Python that runs is a transient code-block sandbox
// subprocess (see app/engine/blocks/codeblock).
package nlpgo

import (
	"context"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/config"
)

// Config is the top-level service configuration.
type Config struct {
	Environment string        `env:"ENVIRONMENT"`
	Server      config.Server `env:"SERVER"`
	Log         clog.Config   `env:"LOG"`
	OTel        config.OTel   `env:"OTEL"`

	// Engine knobs surfaced to operators.
	Engine EngineConfig `env:"NLPGO_ENGINE"`
}

// EngineConfig surfaces engine knobs (timeouts, code-block sandbox).
type EngineConfig struct {
	// StreamHeartbeatSeconds — how often the SSE engine emits is_alive_response.
	StreamHeartbeatSeconds int `env:"STREAM_HEARTBEAT_SECONDS"`
	// StreamIdleTimeoutSeconds — close the SSE stream if no events for this long.
	StreamIdleTimeoutSeconds int `env:"STREAM_IDLE_TIMEOUT_SECONDS"`
	// CodeBlockTimeoutSeconds — kill the user-code subprocess after this.
	CodeBlockTimeoutSeconds int `env:"CODE_BLOCK_TIMEOUT_SECONDS"`
	// AllowedProxyHosts — SSRF allowlist for HTTP blocks (comma-separated).
	AllowedProxyHosts string `env:"ALLOWED_PROXY_HOSTS"`
	// SandboxPython — the python interpreter used for the code block.
	// Default: python3 (resolved via PATH inside the container).
	SandboxPython string `env:"SANDBOX_PYTHON"`
	// LangWatchBaseURL — base URL for evaluator + agent-workflow callbacks.
	// In production this is the public LangWatch app URL (eg.
	// https://app.langwatch.ai); in dev it's typically http://host.docker.internal:5560
	// or http://localhost:5560 depending on the deployment shape.
	// Required for evaluator + agent_type=workflow nodes; absent →
	// those nodes return a typed "evaluator_unconfigured" error.
	LangWatchBaseURL string `env:"LANGWATCH_BASE_URL"`
}

func defaultConfig() Config {
	return Config{
		Environment: "local",
		Server: config.Server{
			Addr:                ":5562",
			GracefulSeconds:     10,
			MaxRequestBodyBytes: config.DefaultMaxRequestBodyBytes,
		},
		Engine: EngineConfig{
			StreamHeartbeatSeconds: 15,
			// 12min idle timeout matches httpblock.DefaultTimeout —
			// the SSE stream must outlive the slowest single agent
			// HTTP call so customers running long agent backends
			// don't see the inbound stream torn down mid-call. Owner
			// anchored both at 12min (under Lambda's 15min cap with
			// margin for the outer connection to drain).
			StreamIdleTimeoutSeconds: 720,
			CodeBlockTimeoutSeconds:  60,
			SandboxPython:            "python3",
		},
		OTel: config.OTel{
			SampleRatio: 1.0, // overridden to 0.1 for non-local in LoadConfig
		},
	}
}

// LoadConfig hydrates the service config from environment variables.
func LoadConfig(ctx context.Context) (Config, error) {
	cfg := defaultConfig()
	if err := config.Hydrate(&cfg); err != nil {
		return Config{}, err
	}
	if cfg.OTel.SampleRatio == 1.0 && cfg.Environment != "local" {
		cfg.OTel.SampleRatio = 0.1
	}
	if err := config.Validate(ctx, cfg); err != nil {
		return Config{}, err
	}
	if err := validateRequired(cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func validateRequired(_ Config) error {
	// Soft requirements — nlpgo boots even when the gateway is
	// unconfigured because the /go/proxy and LLM-block paths fail
	// gracefully, and operators may run nlpgo before every project's
	// model providers are set up. Any non-/go/* request gets a
	// self-explaining 502 from goOnlyModeFallback (see httpapi).
	return nil
}

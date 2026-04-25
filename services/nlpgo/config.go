// Package nlpgo is the LangWatch Go NLP service. It runs alongside
// (in front of) the legacy Python uvicorn process: nlpgo is the
// container entrypoint, owns the new /go/* surface, and reverse-proxies
// everything else to the Python child unchanged.
package nlpgo

import (
	"context"
	"errors"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/config"
)

// Config is the top-level service configuration.
type Config struct {
	Environment string        `env:"ENVIRONMENT"`
	Server      config.Server `env:"SERVER"`
	Log         clog.Config   `env:"LOG"`
	OTel        config.OTel   `env:"OTEL"`

	// Child uvicorn process configuration.
	Child UvicornChildConfig `env:"NLPGO_CHILD"`

	// Engine knobs surfaced to operators.
	Engine EngineConfig `env:"NLPGO_ENGINE"`
}

// UvicornChildConfig controls the langwatch_nlp Python child process.
type UvicornChildConfig struct {
	// Bypass=1 prevents nlpgo from spawning uvicorn at all. Used for
	// emergency rollback (operator points the Lambda Web Adapter at
	// uvicorn directly and disables nlpgo via NLPGO_BYPASS — but in
	// case the operator wants to keep nlpgo running for /go/* while
	// uvicorn is managed externally, this disables the spawn).
	Bypass bool `env:"BYPASS"`
	// Command is the binary to exec. Default: uvicorn.
	Command string `env:"COMMAND"`
	// Args are passed verbatim. Default targets langwatch_nlp.main:app
	// on 127.0.0.1:5561. Supplied as a single space-separated string
	// (config.Hydrate doesn't support []string env unmarshal).
	ArgsRaw string `env:"ARGS"`
	// HealthURL is what nlpgo polls to gauge child readiness.
	HealthURL string `env:"HEALTH_URL"`
	// UpstreamURL is where the reverse proxy sends fall-through traffic.
	// Default: http://127.0.0.1:5561.
	UpstreamURL string `env:"UPSTREAM_URL"`
}

// EngineConfig surfaces engine knobs (timeouts, code-block sandbox).
type EngineConfig struct {
	// StreamHeartbeatSeconds — how often the SSE engine emits is_alive.
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
		Child: UvicornChildConfig{
			Command:     "uvicorn",
			ArgsRaw:     "langwatch_nlp.main:app --host 127.0.0.1 --port 5561",
			HealthURL:   "http://127.0.0.1:5561/health",
			UpstreamURL: "http://127.0.0.1:5561",
		},
		Engine: EngineConfig{
			StreamHeartbeatSeconds:   15,
			StreamIdleTimeoutSeconds: 900,
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

func validateRequired(cfg Config) error {
	// Soft requirements — we let nlpgo boot even when the gateway is
	// unconfigured because the /go/proxy and LLM-block paths fail
	// gracefully and operators may temporarily run nlpgo as a pure
	// reverse proxy during rollout.
	if cfg.Child.Bypass && cfg.Child.UpstreamURL == "" {
		return errors.New("nlpgo: NLPGO_CHILD_UPSTREAM_URL must be set when NLPGO_CHILD_BYPASS=true")
	}
	return nil
}

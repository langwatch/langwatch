package aigateway

import (
	"context"
	"os"
	"time"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/config"
)

// Config is the top-level service configuration.
type Config struct {
	Environment         string                    `env:"ENVIRONMENT"`
	Server              config.Server             `env:"SERVER"`
	Log                 clog.Config               `env:"LOG"`
	ControlPlane        ControlPlaneConfig        `env:"LW_GATEWAY"`
	AuthCache           AuthCacheConfig           `env:"LW_GATEWAY_AUTH_CACHE"`
	CustomerTraceBridge CustomerTraceBridgeConfig `env:"CUSTOMER_TRACE_BRIDGE"`
	OTel                config.OTel               `env:"OTEL"`
}

// ControlPlaneConfig holds control plane connection settings.
type ControlPlaneConfig struct {
	BaseURL        string `env:"BASE_URL"            validate:"required"`
	InternalSecret string `env:"INTERNAL_SECRET"     validate:"required"`
	JWTSecret      string `env:"JWT_SECRET"          validate:"required"`
	JWTSecretPrev  string `env:"JWT_SECRET_PREVIOUS"`
}

// AuthCacheConfig governs the resolver's stale-while-error behavior. The
// gateway is on the hot path of every LLM request, so a brief control-plane
// outage must not translate into mass authentication rejection. When a
// cached entry crosses its JWT exp AND the refresh fails for transport
// reasons (network/timeout/5xx/parse error), the entry's soft expiry is
// extended by SoftBump and the cached bundle continues to serve, up to a
// hard cap of (JWT exp + HardGrace). Any auth-class rejection from the
// control plane (401/403/404) evicts immediately — no grace window for
// known-bad credentials. Setting HardGrace=0 disables stale-while-error
// entirely (legacy behavior).
type AuthCacheConfig struct {
	SoftBump  time.Duration `env:"SOFT_BUMP"`
	HardGrace time.Duration `env:"HARD_GRACE"`
}

// CustomerTraceBridgeConfig holds customer trace bridge settings.
type CustomerTraceBridgeConfig struct {
	// BaseURL is where the customer trace bridge exports spans.
	// Defaults to ControlPlane.BaseURL if not set.
	BaseURL string `env:"BASE_URL"`
}

func defaultConfig() Config {
	return Config{
		Environment: "local",
		Server: config.Server{
			Addr:                ":5563",
			GracefulSeconds:     10,
			MaxRequestBodyBytes: config.DefaultMaxRequestBodyBytes,
		},
		ControlPlane: ControlPlaneConfig{
			BaseURL: "http://localhost:5560",
		},
		OTel: config.OTel{
			SampleRatio: 1.0, // overridden to 0.1 for non-local in LoadConfig
		},
	}
}

// LoadConfig hydrates configuration from environment variables and validates it.
func LoadConfig(ctx context.Context) (Config, error) {
	cfg := defaultConfig()
	if err := config.Hydrate(&cfg); err != nil {
		return Config{}, err
	}
	applyLegacyEnvAliases(&cfg)
	if cfg.CustomerTraceBridge.BaseURL == "" {
		cfg.CustomerTraceBridge.BaseURL = cfg.ControlPlane.BaseURL
	}
	// Apply environment-aware sample ratio default when not explicitly set.
	if cfg.OTel.SampleRatio == 1.0 && cfg.Environment != "local" {
		cfg.OTel.SampleRatio = 0.1
	}
	if err := config.Validate(ctx, cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// applyLegacyEnvAliases reads the chart/saas-style env var names that the
// gateway chart's configmap and the langwatch-saas terraform deployment have
// historically set, and maps them onto the canonical struct fields. The
// canonical names (resolved via the Hydrate prefix scheme — e.g. SERVER_ADDR,
// LW_GATEWAY_BASE_URL, LOG_LEVEL, OTEL_OTLP_ENDPOINT) take precedence; the
// legacy fallbacks only fire when the canonical env var is absent.
//
// Without this layer, both the chart and saas terraform shipped GATEWAY_*
// prefixed env vars that the Go code never read, leaving the gateway running
// on dev defaults (ControlPlane.BaseURL = http://localhost:5560) in any pod
// — passing /healthz but failing every real VK call with auth_upstream_unavailable.
//
// Deprecated: remove once all chart users + saas terraform have migrated to
// canonical names. Track via the existence of GATEWAY_LISTEN_ADDR / friends
// in any deployed configmap or terraform; safe to drop when grep returns
// zero hits across deployment manifests.
func applyLegacyEnvAliases(cfg *Config) {
	type alias struct {
		canonical, legacy string
		apply             func(string)
	}
	aliases := []alias{
		{"SERVER_ADDR", "GATEWAY_LISTEN_ADDR", func(v string) { cfg.Server.Addr = v }},
		{"LW_GATEWAY_BASE_URL", "GATEWAY_CONTROL_PLANE_URL", func(v string) { cfg.ControlPlane.BaseURL = v }},
		{"LOG_LEVEL", "GATEWAY_LOG_LEVEL", func(v string) { cfg.Log.Level = v }},
		{"OTEL_OTLP_ENDPOINT", "GATEWAY_OTEL_DEFAULT_ENDPOINT", func(v string) { cfg.OTel.OTLPEndpoint = v }},
	}
	for _, a := range aliases {
		// Match Hydrate's "empty == not set" semantics (pkg/config/config.go).
		// Treat canonical=unset OR canonical=empty as "open to legacy fallback";
		// only a non-empty canonical value short-circuits the alias.
		if os.Getenv(a.canonical) != "" {
			continue
		}
		if v := os.Getenv(a.legacy); v != "" {
			a.apply(v)
		}
	}
}

package aigateway

import (
	"context"
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

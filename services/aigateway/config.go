package aigateway

import (
	"context"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/config"
)

// Config is the top-level service configuration.
type Config struct {
	Environment  string             `env:"ENVIRONMENT"`
	Server       config.Server      `env:"SERVER"`
	Log          clog.Config        `env:"LOG"`
	ControlPlane ControlPlaneConfig `env:"LW_GATEWAY"`
	CustomerTraceBridge CustomerTraceBridgeConfig `env:"CUSTOMER_TRACE_BRIDGE"`
	OTel         config.OTel        `env:"OTEL"`
}

// ControlPlaneConfig holds control plane connection settings.
type ControlPlaneConfig struct {
	BaseURL        string `env:"BASE_URL"            validate:"required"`
	InternalSecret string `env:"INTERNAL_SECRET"     validate:"required"`
	JWTSecret      string `env:"JWT_SECRET"          validate:"required"`
	JWTSecretPrev  string `env:"JWT_SECRET_PREVIOUS"`
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


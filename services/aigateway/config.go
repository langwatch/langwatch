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
	OTel         OTelConfig         `env:"OTEL"`
}

// ControlPlaneConfig holds control plane connection settings.
type ControlPlaneConfig struct {
	BaseURL        string `env:"BASE_URL"            validate:"required"`
	InternalSecret string `env:"INTERNAL_SECRET"     validate:"required"`
	JWTSecret      string `env:"JWT_SECRET"          validate:"required"`
	JWTSecretPrev  string `env:"JWT_SECRET_PREVIOUS"`
}

// OTelConfig holds telemetry settings.
type OTelConfig struct {
	GatewayEndpoint  string `env:"GATEWAY_ENDPOINT"`
	GatewayAuthToken string `env:"GATEWAY_AUTH_TOKEN"`

	DefaultExportEndpoint string `env:"DEFAULT_EXPORT_ENDPOINT"`
	DefaultAuthToken      string `env:"DEFAULT_AUTH_TOKEN"`

	// SampleRatio controls the fraction of traces sampled (0.0–1.0).
	// Defaults to 1.0 (100%) for local, 0.1 (10%) otherwise.
	// Set OTEL_SAMPLE_RATIO in the environment to override.
	SampleRatio float64 `env:"SAMPLE_RATIO"`
}

func defaultConfig() Config {
	return Config{
		Environment: "local",
		Server: config.Server{
			Addr:            ":5563",
			GracefulSeconds: 10,
		},
		ControlPlane: ControlPlaneConfig{
			BaseURL: "http://localhost:5560",
		},
		OTel: OTelConfig{
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
	// Apply environment-aware sample ratio default when not explicitly set.
	if cfg.OTel.SampleRatio == 1.0 && cfg.Environment != "local" {
		cfg.OTel.SampleRatio = 0.1
	}
	if err := config.Validate(ctx, cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}


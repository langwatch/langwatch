package aigateway

import (
	"context"
	"testing"
)

// LoadConfig with only the two required secrets set should yield in-process defaults.
func TestLoadConfig_Defaults(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Server.Addr != ":5563" {
		t.Errorf("Server.Addr default = %q, want :5563", cfg.Server.Addr)
	}
	if cfg.ControlPlane.BaseURL != "http://localhost:5560" {
		t.Errorf("ControlPlane.BaseURL default = %q, want http://localhost:5560", cfg.ControlPlane.BaseURL)
	}
}

// Canonical env vars (post-Hydrate) should land on the right struct fields.
func TestLoadConfig_CanonicalEnv(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("SERVER_ADDR", ":7777")
	t.Setenv("LW_GATEWAY_BASE_URL", "http://canon.example.com")
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	t.Setenv("OTEL_OTLP_ENDPOINT", "http://canon.otel.example.com")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Server.Addr != ":7777" {
		t.Errorf("Server.Addr = %q, want :7777", cfg.Server.Addr)
	}
	if cfg.ControlPlane.BaseURL != "http://canon.example.com" {
		t.Errorf("ControlPlane.BaseURL = %q, want http://canon.example.com", cfg.ControlPlane.BaseURL)
	}
	if cfg.OTel.OTLPEndpoint != "http://canon.otel.example.com" {
		t.Errorf("OTel.OTLPEndpoint = %q, want http://canon.otel.example.com", cfg.OTel.OTLPEndpoint)
	}
}

// Legacy chart/saas env var names should resolve onto the canonical struct
// fields when the canonical names are absent. This is the recovery path for
// existing langwatch-saas terraform deployments where the gateway pod env
// uses the GATEWAY_* prefix the chart/configmap historically shipped.
func TestLoadConfig_LegacyAliases(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("GATEWAY_LISTEN_ADDR", ":8888")
	t.Setenv("GATEWAY_CONTROL_PLANE_URL", "http://legacy.example.com")
	t.Setenv("GATEWAY_LOG_LEVEL", "debug")
	t.Setenv("GATEWAY_OTEL_DEFAULT_ENDPOINT", "http://legacy.otel.example.com")
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Server.Addr != ":8888" {
		t.Errorf("Server.Addr = %q, want :8888 (from GATEWAY_LISTEN_ADDR)", cfg.Server.Addr)
	}
	if cfg.ControlPlane.BaseURL != "http://legacy.example.com" {
		t.Errorf("ControlPlane.BaseURL = %q, want http://legacy.example.com (from GATEWAY_CONTROL_PLANE_URL)", cfg.ControlPlane.BaseURL)
	}
	if cfg.Log.Level != "debug" {
		t.Errorf("Log.Level = %q, want debug (from GATEWAY_LOG_LEVEL)", cfg.Log.Level)
	}
	if cfg.OTel.OTLPEndpoint != "http://legacy.otel.example.com" {
		t.Errorf("OTel.OTLPEndpoint = %q, want http://legacy.otel.example.com (from GATEWAY_OTEL_DEFAULT_ENDPOINT)", cfg.OTel.OTLPEndpoint)
	}
}

// When both canonical and legacy env vars are set, canonical must win.
func TestLoadConfig_CanonicalBeatsLegacy(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("SERVER_ADDR", ":1111")
	t.Setenv("GATEWAY_LISTEN_ADDR", ":2222")
	t.Setenv("LW_GATEWAY_BASE_URL", "http://canon.example.com")
	t.Setenv("GATEWAY_CONTROL_PLANE_URL", "http://legacy.example.com")
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Server.Addr != ":1111" {
		t.Errorf("Server.Addr = %q, want :1111 (canonical SERVER_ADDR must beat GATEWAY_LISTEN_ADDR)", cfg.Server.Addr)
	}
	if cfg.ControlPlane.BaseURL != "http://canon.example.com" {
		t.Errorf("ControlPlane.BaseURL = %q, want canonical winner", cfg.ControlPlane.BaseURL)
	}
}

// clearGatewayEnv unsets every env var the alias layer or Hydrate inspects,
// so each test starts from a clean slate. t.Setenv handles per-test scope on
// what we explicitly set; this clears the bleed-through from the harness env.
func clearGatewayEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"SERVER_ADDR",
		"SERVER_GRACEFUL_SECONDS",
		"SERVER_MAX_REQUEST_BODY_BYTES",
		"LOG_LEVEL",
		"LW_GATEWAY_BASE_URL",
		"LW_GATEWAY_INTERNAL_SECRET",
		"LW_GATEWAY_JWT_SECRET",
		"LW_GATEWAY_JWT_SECRET_PREVIOUS",
		"LW_GATEWAY_AUTH_CACHE_SOFT_BUMP",
		"LW_GATEWAY_AUTH_CACHE_HARD_GRACE",
		"CUSTOMER_TRACE_BRIDGE_BASE_URL",
		"OTEL_OTLP_ENDPOINT",
		"OTEL_OTLP_HEADERS",
		"OTEL_SAMPLE_RATIO",
		"ENVIRONMENT",
		"GATEWAY_LISTEN_ADDR",
		"GATEWAY_CONTROL_PLANE_URL",
		"GATEWAY_LOG_LEVEL",
		"GATEWAY_OTEL_DEFAULT_ENDPOINT",
	} {
		t.Setenv(k, "")
	}
}

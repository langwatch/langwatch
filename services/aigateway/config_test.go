package aigateway

import (
	"context"
	"testing"
	"time"
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
	if cfg.BlockLocalHTTPCalls {
		t.Error("BlockLocalHTTPCalls default = true, want false for local/self-hosted compatibility")
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
	t.Setenv("BLOCK_LOCAL_HTTP_CALLS", "true")
	t.Setenv("REQUIRE_HTTPS_CUSTOM_ENDPOINTS", "true")
	t.Setenv("ALLOWED_PROXY_HOSTS", "llm.internal,10.0.0.5")

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
	if !cfg.BlockLocalHTTPCalls {
		t.Error("BlockLocalHTTPCalls = false, want true from canonical env")
	}
	if !cfg.RequireHTTPSCustomerEndpoints {
		t.Error("RequireHTTPSCustomerEndpoints = false, want true from hosted-cloud env")
	}
	if cfg.AllowedProxyHosts != "llm.internal,10.0.0.5" {
		t.Errorf("AllowedProxyHosts = %q, want configured exact-host list", cfg.AllowedProxyHosts)
	}
}

func TestLoadConfig_HostedRequiresSSRFControls(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	t.Setenv("BLOCK_LOCAL_HTTP_CALLS", "false")
	t.Setenv("REQUIRE_HTTPS_CUSTOM_ENDPOINTS", "true")

	_, err := LoadConfig(context.Background())
	if err == nil {
		t.Fatal("LoadConfig: expected hosted SSRF startup failure")
	}
	if got := err.Error(); got != "hosted gateway requires BLOCK_LOCAL_HTTP_CALLS=true" {
		t.Fatalf("LoadConfig error = %q", got)
	}
}

func TestLoadConfig_HostedRequiresHTTPS(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("ENVIRONMENT", "staging")
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	t.Setenv("BLOCK_LOCAL_HTTP_CALLS", "true")
	t.Setenv("REQUIRE_HTTPS_CUSTOM_ENDPOINTS", "false")

	_, err := LoadConfig(context.Background())
	if err == nil {
		t.Fatal("LoadConfig: expected hosted HTTPS startup failure")
	}
	if got := err.Error(); got != "hosted gateway requires REQUIRE_HTTPS_CUSTOM_ENDPOINTS=true" {
		t.Fatalf("LoadConfig error = %q", got)
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

// The official OpenTelemetry name is the canonical way in; the LangWatch-only
// OTEL_OTLP_ENDPOINT and the chart-era GATEWAY_OTEL_DEFAULT_ENDPOINT stay as
// deprecated fallbacks behind it.
func TestLoadConfig_OfficialOTelEndpointIsHonoured(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://official.otel.example.com")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	base, _ := cfg.OTel.PrimaryOTLP()
	if base != "http://official.otel.example.com" {
		t.Errorf("PrimaryOTLP base = %q, want the official env var's value", base)
	}
}

// Both names live with different values is ambiguity — whichever silent
// precedence pick is wrong ships telemetry to the wrong place with no error
// anywhere, so boot refuses instead.
func TestLoadConfig_RefusesConflictingOTelEndpointNames(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://official.otel.example.com")
	t.Setenv("OTEL_OTLP_ENDPOINT", "http://legacy.otel.example.com")

	if _, err := LoadConfig(context.Background()); err == nil {
		t.Fatal("expected LoadConfig to reject two different endpoint values")
	}
}

// @scenario "the documented AuthCache duration format actually parses now"
func TestLoadConfig_AuthCacheDurationsParseDocumentedFormat(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	// Exactly the format .env.example documents (and, before this fix,
	// the format that silently could never have worked — every
	// time.Duration field went through the same raw-nanosecond int64
	// path regardless of which struct it lived on).
	t.Setenv("LW_GATEWAY_AUTH_CACHE_SOFT_BUMP", "5m")
	t.Setenv("LW_GATEWAY_AUTH_CACHE_HARD_GRACE", "6h")
	t.Setenv("LW_GATEWAY_AUTH_CACHE_CONFIG_TTL", "90s")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.AuthCache.SoftBump != 5*time.Minute {
		t.Errorf("AuthCache.SoftBump = %v, want 5m", cfg.AuthCache.SoftBump)
	}
	if cfg.AuthCache.HardGrace != 6*time.Hour {
		t.Errorf("AuthCache.HardGrace = %v, want 6h", cfg.AuthCache.HardGrace)
	}
	if cfg.AuthCache.ConfigTTL != 90*time.Second {
		t.Errorf("AuthCache.ConfigTTL = %v, want 90s", cfg.AuthCache.ConfigTTL)
	}
}

// @scenario "SERVER_DRAIN_DELAY_SECONDS reaches Server.DrainDelaySeconds"
func TestLoadConfig_DrainDelaySeconds(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	t.Setenv("SERVER_DRAIN_DELAY_SECONDS", "7")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Server.DrainDelaySeconds != 7 {
		t.Errorf("Server.DrainDelaySeconds = %d, want 7", cfg.Server.DrainDelaySeconds)
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
		"SERVER_DRAIN_DELAY_SECONDS",
		"SERVER_MAX_REQUEST_BODY_BYTES",
		"LOG_LEVEL",
		"LW_GATEWAY_BASE_URL",
		"LW_GATEWAY_INTERNAL_SECRET",
		"LW_GATEWAY_JWT_SECRET",
		"LW_GATEWAY_JWT_SECRET_PREVIOUS",
		"LW_GATEWAY_AUTH_CACHE_SOFT_BUMP",
		"LW_GATEWAY_AUTH_CACHE_HARD_GRACE",
		"LW_GATEWAY_AUTH_CACHE_CONFIG_TTL",
		"CUSTOMER_TRACE_BRIDGE_BASE_URL",
		"OTEL_OTLP_ENDPOINT",
		"OTEL_OTLP_HEADERS",
		"OTEL_SAMPLE_RATIO",
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OTEL_EXPORTER_OTLP_HEADERS",
		"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
		"OTEL_EXPORTER_OTLP_TRACES_HEADERS",
		"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_PROTOCOL",
		"OTEL_TRACES_SAMPLER",
		"OTEL_TRACES_SAMPLER_ARG",
		"OTEL_TRACES_EXPORTER",
		"OTEL_SDK_DISABLED",
		"OTEL_DEBUG_COLLECTOR_ENDPOINT",
		"OTEL_DEBUG_COLLECTOR_HEADERS",
		"ENVIRONMENT",
		"BLOCK_LOCAL_HTTP_CALLS",
		"REQUIRE_HTTPS_CUSTOM_ENDPOINTS",
		"ALLOWED_PROXY_HOSTS",
		"GATEWAY_LISTEN_ADDR",
		"GATEWAY_CONTROL_PLANE_URL",
		"GATEWAY_LOG_LEVEL",
		"GATEWAY_OTEL_DEFAULT_ENDPOINT",
	} {
		t.Setenv(k, "")
	}
}

package aigateway

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/pkg/config"
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

// Spend emission is the only source of gateway budget debits, so an install
// that never heard of the setting must still emit.
func TestLoadConfig_SpendEmitterDefaultsOn(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if !cfg.SpendEmitter.Enabled {
		t.Error("SpendEmitter.Enabled default = false, want true: an unset LW_GATEWAY_SPEND_ENABLED must still emit spend")
	}
}

// The kill switch keeps its documented name and both spellings of off. An
// operator rolling back to a control plane without the ingest route reaches
// for this and cannot afford it to be a no-op.
func TestLoadConfig_SpendEmitterKillSwitch(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  bool
	}{
		{"false", false},
		{"0", false},
		{"true", true},
		{"1", true},
		{"", true}, // Unset: Hydrate leaves the default alone.
	} {
		t.Run("LW_GATEWAY_SPEND_ENABLED="+tc.value, func(t *testing.T) {
			clearGatewayEnv(t)
			t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
			t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
			t.Setenv("LW_GATEWAY_SPEND_ENABLED", tc.value)

			cfg, err := LoadConfig(context.Background())
			if err != nil {
				t.Fatalf("LoadConfig: %v", err)
			}
			if cfg.SpendEmitter.Enabled != tc.want {
				t.Errorf("SpendEmitter.Enabled = %v, want %v for %q", cfg.SpendEmitter.Enabled, tc.want, tc.value)
			}
		})
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

// @scenario "AuthCache seconds-suffixed env vars reach AuthCacheConfig"
func TestLoadConfig_AuthCacheSecondsFields(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	t.Setenv("LW_GATEWAY_AUTH_CACHE_SOFT_BUMP_SECONDS", "300")
	t.Setenv("LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS", "21600")
	t.Setenv("LW_GATEWAY_AUTH_CACHE_CONFIG_TTL_SECONDS", "90")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.AuthCache.SoftBumpSeconds != 300 {
		t.Errorf("AuthCache.SoftBumpSeconds = %d, want 300", cfg.AuthCache.SoftBumpSeconds)
	}
	if cfg.AuthCache.HardGraceSeconds != 21600 {
		t.Errorf("AuthCache.HardGraceSeconds = %d, want 21600", cfg.AuthCache.HardGraceSeconds)
	}
	if cfg.AuthCache.ConfigTTLSeconds != 90 {
		t.Errorf("AuthCache.ConfigTTLSeconds = %d, want 90", cfg.AuthCache.ConfigTTLSeconds)
	}
}

// @scenario "the default graceful window outlasts the heartbeat interval"
func TestLoadConfig_DefaultGracefulWindowOutlastsHeartbeat(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	heartbeat := int(config.DefaultNonStreamingHeartbeatInterval / time.Second)
	if cfg.Server.GracefulSeconds <= heartbeat {
		t.Errorf("Server.GracefulSeconds = %d, want more than the %ds heartbeat interval so stock deployments never warn", cfg.Server.GracefulSeconds, heartbeat)
	}
}

// @scenario "an absurd seconds value is refused instead of overflowing a duration"
func TestLoadConfig_RefusesOutOfRangeSecondsValues(t *testing.T) {
	for _, envVar := range []string{
		"SERVER_GRACEFUL_SECONDS",
		"LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS",
		"NON_STREAMING_HEARTBEAT_INTERVAL_SECONDS",
	} {
		t.Run(envVar, func(t *testing.T) {
			clearGatewayEnv(t)
			t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
			t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
			// A nanosecond count pasted into a seconds field: large enough
			// that multiplying by time.Second wraps int64 into a negative
			// duration, which every consumer would read as "disabled".
			t.Setenv(envVar, "21600000000000")

			if _, err := LoadConfig(context.Background()); err == nil {
				t.Fatalf("expected %s=21600000000000 to be refused", envVar)
			}
		})
	}
}

// @scenario "the largest in-range seconds value is accepted and the next one is not"
func TestLoadConfig_SecondsRangeBoundary(t *testing.T) {
	t.Run("at the maximum", func(t *testing.T) {
		clearGatewayEnv(t)
		t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
		t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
		t.Setenv("LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS", strconv.FormatInt(MaxConfigurableSeconds, 10))

		cfg, err := LoadConfig(context.Background())
		if err != nil {
			t.Fatalf("LoadConfig at the maximum: %v", err)
		}
		// The value the guard exists to protect: the conversion deps.go
		// performs has to stay a positive duration at the boundary.
		if got := time.Duration(cfg.AuthCache.HardGraceSeconds) * time.Second; got <= 0 {
			t.Errorf("HardGrace converted to %v, want a positive duration", got)
		}
	})

	t.Run("one second past the maximum", func(t *testing.T) {
		clearGatewayEnv(t)
		t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
		t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
		t.Setenv("LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS", strconv.FormatInt(MaxConfigurableSeconds+1, 10))

		if _, err := LoadConfig(context.Background()); err == nil {
			t.Fatal("expected the first out-of-range value to be refused")
		}
	})
}

// @scenario "a negative shutdown budget is refused instead of draining nothing"
func TestLoadConfig_RefusesNegativeWaits(t *testing.T) {
	for _, envVar := range []string{"SERVER_GRACEFUL_SECONDS", "SERVER_DRAIN_DELAY_SECONDS"} {
		t.Run(envVar, func(t *testing.T) {
			clearGatewayEnv(t)
			t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
			t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
			t.Setenv(envVar, "-1")

			_, err := LoadConfig(context.Background())
			if err == nil {
				t.Fatalf("expected %s=-1 to be refused", envVar)
			}
			if !strings.Contains(err.Error(), envVar) {
				t.Errorf("error %q does not name %s", err, envVar)
			}
		})
	}
}

// @scenario "zero is accepted as an explicit no-wait"
func TestLoadConfig_AcceptsZeroWaits(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	t.Setenv("SERVER_DRAIN_DELAY_SECONDS", "0")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Server.DrainDelaySeconds != 0 {
		t.Errorf("Server.DrainDelaySeconds = %d, want 0", cfg.Server.DrainDelaySeconds)
	}
}

// @scenario "a retired duration-string variable stops startup and names its replacement"
func TestLoadConfig_RefusesRetiredDurationEnvVars(t *testing.T) {
	for _, v := range retiredEnvVars {
		t.Run(v.old, func(t *testing.T) {
			clearGatewayEnv(t)
			t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
			t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
			t.Setenv(v.old, "6h")

			_, err := LoadConfig(context.Background())
			if err == nil {
				t.Fatalf("expected %s to be refused", v.old)
			}
			if !strings.Contains(err.Error(), v.replacement) {
				t.Errorf("error %q does not name the replacement %s", err, v.replacement)
			}
		})
	}
}

// @scenario "a legitimate large seconds value is still accepted"
func TestLoadConfig_AcceptsLargeButSaneSecondsValues(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("LW_GATEWAY_INTERNAL_SECRET", "internal-1")
	t.Setenv("LW_GATEWAY_JWT_SECRET", "jwt-1")
	t.Setenv("LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS", "31536000") // one year

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.AuthCache.HardGraceSeconds != 31536000 {
		t.Errorf("AuthCache.HardGraceSeconds = %d, want 31536000", cfg.AuthCache.HardGraceSeconds)
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
		"NON_STREAMING_HEARTBEAT_INTERVAL_SECONDS",
		"LW_GATEWAY_CIRCUIT_WINDOW_S",
		"LW_GATEWAY_CIRCUIT_COOLDOWN_S",
		"LOG_LEVEL",
		"LW_GATEWAY_BASE_URL",
		"LW_GATEWAY_INTERNAL_SECRET",
		"LW_GATEWAY_JWT_SECRET",
		"LW_GATEWAY_JWT_SECRET_PREVIOUS",
		"LW_GATEWAY_AUTH_CACHE_SOFT_BUMP_SECONDS",
		"LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS",
		"LW_GATEWAY_AUTH_CACHE_CONFIG_TTL_SECONDS",
		"LW_GATEWAY_AUTH_CACHE_SOFT_BUMP",
		"LW_GATEWAY_AUTH_CACHE_HARD_GRACE",
		"LW_GATEWAY_AUTH_CACHE_CONFIG_TTL",
		"CUSTOMER_TRACE_BRIDGE_BASE_URL",
		"LW_GATEWAY_SPEND_ENABLED",
		"LW_GATEWAY_SPEND_SPOOL_DIR",
		"LW_GATEWAY_SPEND_SPOOL_MAX_BYTES",
		"LW_GATEWAY_SPEND_FLUSH_INTERVAL_SECONDS",
		"LW_GATEWAY_SPEND_INGEST_BASE_URL",
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

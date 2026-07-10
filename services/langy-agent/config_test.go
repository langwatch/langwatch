package langyagent

import (
	"context"
	"testing"
	"time"
)

// clearLangyEnv blanks the env vars LoadConfig reads so a test starts from a
// known baseline regardless of the ambient shell. Setting to "" makes Hydrate
// skip the field and keep its default.
func clearLangyEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"ENVIRONMENT", "PORT", "LANGY_INTERNAL_SECRET", "LANGY_MAX_WORKERS",
		"LANGY_WORKER_IDLE_MS", "LANGY_READINESS_TIMEOUT_MS", "SESSIONS_ROOT",
		"OPENCODE_OTEL_PLUGIN_VERSION", "LOG_LEVEL", "LOG_FORMAT",
		"OTEL_OTLP_ENDPOINT", "OTEL_SAMPLE_RATIO",
	} {
		t.Setenv(k, "")
	}
}

func TestLoadConfig_DefaultsWhenOnlySecretSet(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Port != 8080 {
		t.Errorf("Port default = %d, want 8080", cfg.Port)
	}
	if cfg.Server.Addr != ":8080" {
		t.Errorf("Server.Addr = %q, want :8080", cfg.Server.Addr)
	}
	if cfg.MaxWorkers != 20 {
		t.Errorf("MaxWorkers default = %d, want 20", cfg.MaxWorkers)
	}
	if cfg.WorkerIdle() != 10*time.Minute {
		t.Errorf("WorkerIdle default = %s, want 10m", cfg.WorkerIdle())
	}
	if cfg.ReadinessTimeout() != 15*time.Second {
		t.Errorf("ReadinessTimeout default = %s, want 15s", cfg.ReadinessTimeout())
	}
	if cfg.Server.MaxRequestBodyBytes != defaultMaxBodyBytes {
		t.Errorf("MaxRequestBodyBytes default = %d, want %d", cfg.Server.MaxRequestBodyBytes, defaultMaxBodyBytes)
	}
	if cfg.OTelPluginVersion != "1.0.0" {
		t.Errorf("OTelPluginVersion default = %q, want 1.0.0", cfg.OTelPluginVersion)
	}
	if cfg.OpenCodeBinaryPath != "opencode" {
		t.Errorf("OpenCodeBinaryPath default = %q, want opencode", cfg.OpenCodeBinaryPath)
	}
}

func TestLoadConfig_EnvOverrides(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")
	t.Setenv("PORT", "9000")
	t.Setenv("LANGY_MAX_WORKERS", "5")
	t.Setenv("LANGY_WORKER_IDLE_MS", "1000")
	t.Setenv("LANGY_READINESS_TIMEOUT_MS", "2000")
	t.Setenv("SESSIONS_ROOT", "/tmp/langy-sessions")
	t.Setenv("OPENCODE_OTEL_PLUGIN_VERSION", "2.3.4")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Port != 9000 || cfg.Server.Addr != ":9000" {
		t.Errorf("Port override = %d / %q, want 9000 / :9000", cfg.Port, cfg.Server.Addr)
	}
	if cfg.MaxWorkers != 5 {
		t.Errorf("MaxWorkers override = %d, want 5", cfg.MaxWorkers)
	}
	if cfg.WorkerIdle() != time.Second {
		t.Errorf("WorkerIdle override = %s, want 1s", cfg.WorkerIdle())
	}
	if cfg.ReadinessTimeout() != 2*time.Second {
		t.Errorf("ReadinessTimeout override = %s, want 2s", cfg.ReadinessTimeout())
	}
	if cfg.SessionsRoot != "/tmp/langy-sessions" {
		t.Errorf("SessionsRoot override = %q", cfg.SessionsRoot)
	}
	if cfg.OTelPluginVersion != "2.3.4" {
		t.Errorf("OTelPluginVersion override = %q, want 2.3.4", cfg.OTelPluginVersion)
	}
}

func TestLoadConfig_MissingSecretFailsFast(t *testing.T) {
	clearLangyEnv(t)
	// LANGY_INTERNAL_SECRET intentionally left unset.
	if _, err := LoadConfig(context.Background()); err == nil {
		t.Fatalf("expected LoadConfig to fail without LANGY_INTERNAL_SECRET")
	}
}

func TestLoadConfig_InvalidPortFailsFast(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")
	t.Setenv("PORT", "0")
	if _, err := LoadConfig(context.Background()); err == nil {
		t.Fatalf("expected LoadConfig to reject PORT=0")
	}
}

func TestLoadConfig_NonLocalLowersSampleRatio(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")
	t.Setenv("ENVIRONMENT", "production")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.OTel.SampleRatio != 0.1 {
		t.Errorf("non-local SampleRatio = %v, want 0.1", cfg.OTel.SampleRatio)
	}
}

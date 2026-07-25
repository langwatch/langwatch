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
		"LANGY_WORKER_IDLE_MS", "LANGY_REAPER_INTERVAL_MS", "LANGY_READINESS_TIMEOUT_MS", "SESSIONS_ROOT",
		"LANGY_WORKSPACE_ROOT", "LANGY_UNSAFE_DEV_DISABLE_ISOLATION",
		"LOG_LEVEL", "LOG_FORMAT",
		"OTEL_OTLP_ENDPOINT", "OTEL_OTLP_HEADERS", "OTEL_SAMPLE_RATIO",
		"OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS",
		"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
		"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_PROTOCOL", "OTEL_TRACES_SAMPLER", "OTEL_TRACES_SAMPLER_ARG",
		"OTEL_TRACES_EXPORTER", "OTEL_SDK_DISABLED",
		"OTEL_DEBUG_COLLECTOR_ENDPOINT", "OTEL_DEBUG_COLLECTOR_HEADERS",
		"LANGY_SHUTDOWN_HANDOFF_DEADLINE_MS", "LANGY_SHUTDOWN_DRAIN_BUDGET_MS",
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
	if cfg.ReaperInterval() != 30*time.Second {
		t.Errorf("ReaperInterval default = %s, want 30s", cfg.ReaperInterval())
	}
	if cfg.ReadinessTimeout() != 15*time.Second {
		t.Errorf("ReadinessTimeout default = %s, want 15s", cfg.ReadinessTimeout())
	}
	if cfg.Server.MaxRequestBodyBytes != defaultMaxBodyBytes {
		t.Errorf("MaxRequestBodyBytes default = %d, want %d", cfg.Server.MaxRequestBodyBytes, defaultMaxBodyBytes)
	}
	if cfg.OpenCodeBinaryPath != "opencode" {
		t.Errorf("OpenCodeBinaryPath default = %q, want opencode", cfg.OpenCodeBinaryPath)
	}
	if cfg.WorkspaceRoot != "/workspace" {
		t.Errorf("WorkspaceRoot default = %q, want /workspace", cfg.WorkspaceRoot)
	}
	if cfg.UnsafeDevDisableIsolation {
		t.Errorf("UnsafeDevDisableIsolation default = true, want false")
	}
}

func TestLoadConfig_EnvOverrides(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")
	t.Setenv("PORT", "9000")
	t.Setenv("LANGY_MAX_WORKERS", "5")
	t.Setenv("LANGY_WORKER_IDLE_MS", "1000")
	t.Setenv("LANGY_REAPER_INTERVAL_MS", "250")
	t.Setenv("LANGY_READINESS_TIMEOUT_MS", "2000")
	t.Setenv("SESSIONS_ROOT", "/tmp/langy-sessions")
	t.Setenv("LANGY_WORKSPACE_ROOT", "/tmp/langy-workspace")

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
	if cfg.ReaperInterval() != 250*time.Millisecond {
		t.Errorf("ReaperInterval override = %s, want 250ms", cfg.ReaperInterval())
	}
	if cfg.ReadinessTimeout() != 2*time.Second {
		t.Errorf("ReadinessTimeout override = %s, want 2s", cfg.ReadinessTimeout())
	}
	if cfg.SessionsRoot != "/tmp/langy-sessions" {
		t.Errorf("SessionsRoot override = %q", cfg.SessionsRoot)
	}
	if cfg.WorkspaceRoot != "/tmp/langy-workspace" {
		t.Errorf("WorkspaceRoot override = %q, want /tmp/langy-workspace", cfg.WorkspaceRoot)
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

// No environment lowers the default for backend services: full sampling holds
// in production too, unless an operator says otherwise.
func TestLoadConfig_NonLocalStillSamplesEverything(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")
	t.Setenv("ENVIRONMENT", "production")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if got := cfg.OTel.SamplerChoice().Ratio; got != 1.0 {
		t.Errorf("non-local sampler ratio = %v, want 1.0 (backend services sample everything by default)", got)
	}
}

func TestLoadConfig_ExplicitZeroSampleRatioIsPreserved(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("OTEL_SAMPLE_RATIO", "0")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if got := cfg.OTel.SamplerChoice().Ratio; got != 0 {
		t.Fatalf("explicit zero sample ratio resolved to %v, want 0", got)
	}
}

func TestLoadConfig_OfficialSamplerVarsAreHonoured(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("OTEL_TRACES_SAMPLER", "parentbased_traceidratio")
	t.Setenv("OTEL_TRACES_SAMPLER_ARG", "0.25")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if got := cfg.OTel.SamplerChoice().Ratio; got != 0.25 {
		t.Fatalf("official sampler ratio = %v, want 0.25", got)
	}
}

func TestLoadConfig_OfficialEndpointNameIsHonoured(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	base, _ := cfg.OTel.PrimaryOTLP()
	if base != "http://localhost:4318" {
		t.Fatalf("PrimaryOTLP base = %q, want the official env var's value", base)
	}
}

func TestLoadConfig_UnsafeDevDisableIsolationAllowedInLocalEnvs(t *testing.T) {
	for _, env := range []string{"local", "dev", "development", "test", "LOCAL", "  dev  "} {
		t.Run(env, func(t *testing.T) {
			clearLangyEnv(t)
			t.Setenv("LANGY_INTERNAL_SECRET", "secret")
			t.Setenv("ENVIRONMENT", env)
			t.Setenv("LANGY_UNSAFE_DEV_DISABLE_ISOLATION", "true")

			cfg, err := LoadConfig(context.Background())
			if err != nil {
				t.Fatalf("LoadConfig(ENVIRONMENT=%q) = %v, want nil", env, err)
			}
			if !cfg.UnsafeDevDisableIsolation {
				t.Errorf("UnsafeDevDisableIsolation = false, want true for env %q", env)
			}
		})
	}
}

func TestLoadConfig_UnsafeDevDisableIsolationRefusedInNonLocalEnvs(t *testing.T) {
	// Allowlist fail-closed: production, staging, and any unknown/prod-like value
	// must reject the bypass, so it can never be armed off a dev box.
	for _, env := range []string{"production", "staging", "prod-eu", "preview"} {
		t.Run(env, func(t *testing.T) {
			clearLangyEnv(t)
			t.Setenv("LANGY_INTERNAL_SECRET", "secret")
			t.Setenv("ENVIRONMENT", env)
			t.Setenv("LANGY_UNSAFE_DEV_DISABLE_ISOLATION", "true")

			if _, err := LoadConfig(context.Background()); err == nil {
				t.Fatalf("expected LoadConfig to refuse LANGY_UNSAFE_DEV_DISABLE_ISOLATION when ENVIRONMENT=%q", env)
			}
		})
	}
}

func TestLoadConfig_ShutdownHandoffDefaults(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.ShutdownHandoffDeadline() != 5*time.Second {
		t.Errorf("ShutdownHandoffDeadline default = %s, want 5s", cfg.ShutdownHandoffDeadline())
	}
	if cfg.ShutdownDrainBudget() != 3*time.Second {
		t.Errorf("ShutdownDrainBudget default = %s, want 3s", cfg.ShutdownDrainBudget())
	}
	// The ADR-048 invariant holds for the defaults: handoff + drain (8s) < the
	// 10s default graceful window.
	if d := cfg.ShutdownHandoffDeadlineMS + cfg.ShutdownDrainBudgetMS; d >= int64(cfg.Server.GracefulSeconds)*1000 {
		t.Errorf("defaults violate the ADR-048 deadline math: %d >= %d", d, int64(cfg.Server.GracefulSeconds)*1000)
	}
}

// The ADR-048 deadline math is enforced at load: handoff + drain must be
// strictly less than the graceful window, so the worker-authored checkpoint AND
// the process-group kill both fit before the graceful deadline (which the
// operator sizes below terminationGracePeriodSeconds — SIGKILL is uncatchable).
func TestLoadConfig_ShutdownHandoffDeadlineMathRefused(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")
	// Default graceful window is 10s; 8s handoff + 3s drain = 11s overruns it.
	t.Setenv("LANGY_SHUTDOWN_HANDOFF_DEADLINE_MS", "8000")
	t.Setenv("LANGY_SHUTDOWN_DRAIN_BUDGET_MS", "3000")

	if _, err := LoadConfig(context.Background()); err == nil {
		t.Fatalf("expected LoadConfig to refuse handoff+drain that overrun the graceful window")
	}
}

func TestLoadConfig_ShutdownHandoffBudgetsWithinGracefulAccepted(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")
	// 4s handoff + 2s drain = 6s < 10s graceful window.
	t.Setenv("LANGY_SHUTDOWN_HANDOFF_DEADLINE_MS", "4000")
	t.Setenv("LANGY_SHUTDOWN_DRAIN_BUDGET_MS", "2000")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.ShutdownHandoffDeadline() != 4*time.Second {
		t.Errorf("ShutdownHandoffDeadline = %s, want 4s", cfg.ShutdownHandoffDeadline())
	}
}

func TestLoadConfig_SamplerDefaultsToFullParentBased(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	choice := cfg.OTel.SamplerChoice()
	if !choice.ParentBased || choice.Ratio != 1.0 {
		t.Fatalf("ops telemetry must default to full parent-based sampling, got %+v", choice)
	}
}

func TestLoadConfig_SamplerEnvStillWins(t *testing.T) {
	clearLangyEnv(t)
	t.Setenv("LANGY_INTERNAL_SECRET", "secret")
	t.Setenv("OTEL_TRACES_SAMPLER", "parentbased_traceidratio")
	t.Setenv("OTEL_TRACES_SAMPLER_ARG", "0.2")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	choice := cfg.OTel.SamplerChoice()
	if !choice.ParentBased || choice.Ratio != 0.2 {
		t.Fatalf("operator sampler must win over the service default, got %+v", choice)
	}
}

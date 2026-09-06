package langyagent

import (
	"testing"

	"go.uber.org/zap"
)

func fieldValue(t *testing.T, fields []zap.Field, key string) string {
	t.Helper()
	for _, f := range fields {
		if f.Key == key {
			return f.String
		}
	}
	t.Fatalf("startup line has no %q field", key)
	return ""
}

// @scenario "The manager says which isolation it booted with"
func TestStartupFields_SayWhatTheManagerIsRunningWith(t *testing.T) {
	cfg := defaultConfig()
	cfg.Server.Addr = ":8080"
	cfg.UnsafeDevDisableIsolation = true

	fields := startupFields(cfg)

	if got := fieldValue(t, fields, "isolation"); got != "disabled" {
		t.Errorf("isolation = %q, want %q for a manager booted with the bypass on", got, "disabled")
	}
	if got := fieldValue(t, fields, "harness"); got != "pi" {
		t.Errorf("harness = %q, want %q — the only harness the manager spawns", got, "pi")
	}
	if got := fieldValue(t, fields, "environment"); got != cfg.Environment {
		t.Errorf("environment = %q, want %q", got, cfg.Environment)
	}
	if got := fieldValue(t, fields, "worker_binary"); got != cfg.PiWorkerBinaryPath {
		t.Errorf("worker_binary = %q, want %q", got, cfg.PiWorkerBinaryPath)
	}
	if got := fieldValue(t, fields, "sessions_root"); got != cfg.SessionsRoot {
		t.Errorf("sessions_root = %q, want %q", got, cfg.SessionsRoot)
	}
}

func TestStartupFields_ProductionSandboxIsNamedToo(t *testing.T) {
	cfg := defaultConfig()

	if got := fieldValue(t, startupFields(cfg), "isolation"); got != "uid-sandbox" {
		t.Errorf("isolation = %q, want %q when the per-worker UID sandbox is active", got, "uid-sandbox")
	}
}

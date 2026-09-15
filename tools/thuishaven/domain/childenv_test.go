package domain

import (
	"strings"
	"testing"
)

// TestNodeOptionsEnv_AddsTheWarningSwitch pins the one place the experimental
// warning is turned off.
//
/** @scenario "A Node lane does not announce the flag it always runs with" */
func TestNodeOptionsEnv_AddsTheWarningSwitch(t *testing.T) {
	if got := NodeOptionsEnv(""); got != "NODE_OPTIONS="+NodeQuietFlags {
		t.Errorf("NodeOptionsEnv(\"\") = %q, want the quiet flags alone", got)
	}
}

// TestNodeOptionsEnv_KeepsWhatTheShellSet pins that a developer's own
// NODE_OPTIONS survives — haven adds to it, it does not own it.
//
/** @scenario "A Node lane does not announce the flag it always runs with" */
func TestNodeOptionsEnv_KeepsWhatTheShellSet(t *testing.T) {
	got := NodeOptionsEnv("--max-old-space-size=8192")

	if !strings.Contains(got, "--max-old-space-size=8192") {
		t.Errorf("NodeOptionsEnv dropped the inherited value: %q", got)
	}
	if !strings.Contains(got, NodeQuietFlags) {
		t.Errorf("NodeOptionsEnv did not add the quiet flags: %q", got)
	}
}

// TestNodeOptionsEnv_DoesNotRepeatItself pins idempotence: a nested haven run
// must not stack the same flag twice.
//
/** @scenario "A Node lane does not announce the flag it always runs with" */
func TestNodeOptionsEnv_DoesNotRepeatItself(t *testing.T) {
	got := NodeOptionsEnv(NodeQuietFlags)

	if strings.Count(got, NodeQuietFlags) != 1 {
		t.Errorf("NodeOptionsEnv repeated the flag: %q", got)
	}
}

// TestTelemetryOffEnv_StatesTheAbsence pins that a stack with no observability
// container says so, rather than leaving a stale endpoint inherited.
//
/** @scenario "A stack without the observability container exports no metrics" */
func TestTelemetryOffEnv_StatesTheAbsence(t *testing.T) {
	env := TelemetryOffEnv()

	if got := valueOf(env, "OTEL_DEBUG_COLLECTOR_ENDPOINT"); got != "" {
		t.Errorf("OTEL_DEBUG_COLLECTOR_ENDPOINT = %q, want empty", got)
	}
	if !keyPresent(env, "OTEL_DEBUG_COLLECTOR_ENDPOINT") {
		t.Error("OTEL_DEBUG_COLLECTOR_ENDPOINT is not assigned at all, so a stale value is inherited")
	}
	if got := valueOf(env, "OTEL_METRICS_ENABLED"); got != "false" {
		t.Errorf("OTEL_METRICS_ENABLED = %q, want false", got)
	}
}

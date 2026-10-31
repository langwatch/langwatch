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
	if got := NodeOptionsEnv(""); got != "NODE_OPTIONS="+NodeQuietFlags+" "+NodeInspectPortFlag {
		t.Errorf("NodeOptionsEnv(\"\") = %q, want the quiet flags and the free inspector port alone", got)
	}
}

// TestNodeOptionsEnv_InspectorOnAFreePort pins that SIGUSR1 opens a lane's
// inspector on a free port, unless the shell already chose one.
//
/** @scenario "The inspector is opened for the profile and closed after" */
func TestNodeOptionsEnv_InspectorOnAFreePort(t *testing.T) {
	if got := NodeOptionsEnv("--max-old-space-size=8192"); !strings.Contains(got, NodeInspectPortFlag) {
		t.Errorf("NodeOptionsEnv did not add the free inspector port: %q", got)
	}
	got := NodeOptionsEnv("--inspect-port=9300")
	if strings.Contains(got, NodeInspectPortFlag) || !strings.Contains(got, "--inspect-port=9300") {
		t.Errorf("NodeOptionsEnv overrode the shell's own inspector port: %q", got)
	}
	if again := NodeOptionsEnv(strings.TrimPrefix(NodeOptionsEnv(""), "NODE_OPTIONS=")); strings.Count(again, NodeInspectPortFlag) != 1 {
		t.Errorf("NodeOptionsEnv repeated the inspector flag: %q", again)
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

// TestNodeOptionsEnv_DoesNotRepeatItself pins idempotence: a nested haven machine run
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

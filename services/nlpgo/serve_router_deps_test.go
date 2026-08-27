package nlpgo

import (
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// TestNewRouterDeps_AppliesConfiguredStreamHeartbeat pins the operator
// knob to the transport option that enforces it.
// NLPGO_ENGINE_STREAM_HEARTBEAT_SECONDS was declared, defaulted,
// documented and unit-tested, but no runtime component ever read it:
// the SSE handler carried its own hardcoded 15s, so an operator who
// shortened the cadence to survive a proxy with a tighter read timeout
// changed nothing.
func TestNewRouterDeps_AppliesConfiguredStreamHeartbeat(t *testing.T) {
	cfg := defaultConfig()
	cfg.Engine.StreamHeartbeatSeconds = 30

	got := newRouterDeps(app.New(), newTestDeps(t), cfg, "test", nil)

	if want := 30 * time.Second; got.StreamHeartbeat != want {
		t.Errorf("StreamHeartbeat = %v; want %v (NLPGO_ENGINE_STREAM_HEARTBEAT_SECONDS=30)",
			got.StreamHeartbeat, want)
	}
}

// TestNewRouterDeps_UnsetHeartbeatDefersToTheAdapterDefault guards the
// wiring against turning an unset knob into a zero cadence: the engine
// starts no heartbeat goroutine below one, so zero must mean "the
// adapter decides", not "no heartbeats".
func TestNewRouterDeps_UnsetHeartbeatDefersToTheAdapterDefault(t *testing.T) {
	cfg := defaultConfig()
	cfg.Engine.StreamHeartbeatSeconds = 0

	got := newRouterDeps(app.New(), newTestDeps(t), cfg, "test", nil)

	if got.StreamHeartbeat != 0 {
		t.Errorf("StreamHeartbeat = %v; want 0 so httpapi.DefaultStreamHeartbeat (%v) applies",
			got.StreamHeartbeat, httpapi.DefaultStreamHeartbeat)
	}
}

// TestNewRouterDeps_DefaultConfigCarriesTheContractCadence closes the
// loop on the shipped default: an operator who sets nothing must still
// get contract.md §6's 15s, now sourced from config rather than from a
// constant buried in the handler.
func TestNewRouterDeps_DefaultConfigCarriesTheContractCadence(t *testing.T) {
	got := newRouterDeps(app.New(), newTestDeps(t), defaultConfig(), "test", nil)

	if want := httpapi.DefaultStreamHeartbeat; got.StreamHeartbeat != want {
		t.Errorf("StreamHeartbeat = %v; want %v (contract.md §6)", got.StreamHeartbeat, want)
	}
}

// TestResolveStreamHeartbeat covers the misconfiguration edge. A
// negative NLPGO_ENGINE_STREAM_HEARTBEAT_SECONDS must not travel to the
// engine as a negative duration: ExecuteStream only starts the
// heartbeat goroutine for a positive interval, so a typo would silently
// stop every is_alive_response frame instead of being corrected.
func TestResolveStreamHeartbeat(t *testing.T) {
	cases := []struct {
		name    string
		seconds int
		want    time.Duration
	}{
		{name: "a configured value is seconds", seconds: 30, want: 30 * time.Second},
		{name: "one second is honored", seconds: 1, want: time.Second},
		{name: "the shipped default", seconds: 15, want: 15 * time.Second},
		{name: "unset defers to the adapter default", seconds: 0, want: 0},
		{name: "negative defers rather than disabling", seconds: -1, want: 0},
		{name: "a large negative still defers", seconds: -3600, want: 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveStreamHeartbeat(tc.seconds); got != tc.want {
				t.Errorf("resolveStreamHeartbeat(%d) = %v; want %v", tc.seconds, got, tc.want)
			}
		})
	}
}

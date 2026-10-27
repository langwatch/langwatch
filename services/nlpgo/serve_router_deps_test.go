package nlpgo

import (
	"context"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

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

	got := newRouterDeps(routerDepsInput{App: app.New(), Deps: newTestDeps(t), Cfg: cfg, Version: "test"})

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

	got := newRouterDeps(routerDepsInput{App: app.New(), Deps: newTestDeps(t), Cfg: cfg, Version: "test"})

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
	got := newRouterDeps(routerDepsInput{App: app.New(), Deps: newTestDeps(t), Cfg: defaultConfig(), Version: "test"})

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

// TestNewRouterDeps_AppliesConfiguredStreamIdleTimeout pins the second dead
// knob to the transport option that enforces it.
// NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS was declared, defaulted and
// documented, but no runtime component ever read it: the SSE handler drained
// the engine channel with a bare range, so a stream that went silent stayed
// open until the client or a proxy gave up.
func TestNewRouterDeps_AppliesConfiguredStreamIdleTimeout(t *testing.T) {
	cfg := defaultConfig()
	cfg.Engine.StreamIdleTimeoutSeconds = 30

	got := newRouterDeps(routerDepsInput{App: app.New(), Deps: newTestDeps(t), Cfg: cfg, Version: "test"})

	if want := 30 * time.Second; got.StreamIdleTimeout != want {
		t.Errorf("StreamIdleTimeout = %v; want %v (NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS=30)",
			got.StreamIdleTimeout, want)
	}
}

// TestNewRouterDeps_DefaultConfigCarriesTheShippedIdleBudget closes the loop
// on the shipped default: an operator who sets nothing gets the 12 minutes
// config.go anchors to httpblock.DefaultTimeout, sourced from config rather
// than from a constant buried in the handler.
func TestNewRouterDeps_DefaultConfigCarriesTheShippedIdleBudget(t *testing.T) {
	got := newRouterDeps(routerDepsInput{App: app.New(), Deps: newTestDeps(t), Cfg: defaultConfig(), Version: "test"})

	if want := httpapi.DefaultStreamIdleTimeout; got.StreamIdleTimeout != want {
		t.Errorf("StreamIdleTimeout = %v; want %v", got.StreamIdleTimeout, want)
	}
}

// TestResolveStreamIdleTimeout covers the misconfiguration edge. A
// non-positive NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS must defer to the
// adapter default rather than travel on as a zero budget, which would arm a
// timer that fires before the first engine event and cut every stream off.
func TestResolveStreamIdleTimeout(t *testing.T) {
	cases := []struct {
		name    string
		seconds int
		want    time.Duration
	}{
		{name: "a configured value is seconds", seconds: 30, want: 30 * time.Second},
		{name: "the shipped default", seconds: 720, want: 720 * time.Second},
		{name: "unset defers to the adapter default", seconds: 0, want: 0},
		{name: "negative defers rather than cutting off", seconds: -1, want: 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveStreamIdleTimeout(tc.seconds); got != tc.want {
				t.Errorf("resolveStreamIdleTimeout(%d) = %v; want %v", tc.seconds, got, tc.want)
			}
		})
	}
}

// TestNewRouterDeps_CarriesTheInternalSecret pins
// LANGWATCH_NLP_INTERNAL_SECRET to the transport option that enforces it.
// The guard lives in the router, so a value that reaches the config and
// stops there would leave every /go route open while the operator reads
// their own configuration and concludes otherwise.
func TestNewRouterDeps_CarriesTheInternalSecret(t *testing.T) {
	cfg := defaultConfig()
	cfg.InternalSecret = "shared-with-the-app"

	got := newRouterDeps(routerDepsInput{App: app.New(), Deps: newTestDeps(t), Cfg: cfg, Version: "test"})

	if got.InternalSecret != "shared-with-the-app" {
		t.Errorf("InternalSecret = %q; want the configured value to reach the router",
			got.InternalSecret)
	}
}

// TestNewRouterDeps_UnsetInternalSecretStaysUnset keeps the
// upgrade-compatibility path honest: an install that has not been given the
// variable must reach the router with an empty secret, which is what leaves
// its /go routes serving.
func TestNewRouterDeps_UnsetInternalSecretStaysUnset(t *testing.T) {
	got := newRouterDeps(routerDepsInput{App: app.New(), Deps: newTestDeps(t), Cfg: defaultConfig(), Version: "test"})

	if got.InternalSecret != "" {
		t.Errorf("InternalSecret = %q; want empty so an unconfigured install keeps serving",
			got.InternalSecret)
	}
}

// @scenario "an unconfigured engine reports the gap at startup"
func TestLogInternalAuthPosture_WarnsWhenNoSecretIsConfigured(t *testing.T) {
	core, logs := observer.New(zapcore.WarnLevel)

	logInternalAuthPosture(zap.New(core), "")

	entries := logs.FilterMessage("nlpgo_internal_auth_disabled").All()
	if len(entries) != 1 {
		t.Fatalf("got %d nlpgo_internal_auth_disabled entries; want 1 so an operator reading the log of an unguarded install finds it stated", len(entries))
	}
	fields := entries[0].ContextMap()
	if got := fields["variable"]; got != "LANGWATCH_NLP_INTERNAL_SECRET" {
		t.Errorf("variable = %v; the warning must name the variable that turns the guard on", got)
	}
	if entries[0].Level != zapcore.WarnLevel {
		t.Errorf("level = %v; want warn, so the line survives a deployment logging at warn and above", entries[0].Level)
	}
}

// TestLogInternalAuthPosture_StaysQuietAtWarnWhenConfigured keeps the warning
// meaningful: a guarded install must not emit it, or an operator learns to
// ignore the one line that tells them they are unguarded.
func TestLogInternalAuthPosture_StaysQuietAtWarnWhenConfigured(t *testing.T) {
	core, logs := observer.New(zapcore.WarnLevel)

	logInternalAuthPosture(zap.New(core), "shared-with-the-app")

	if n := logs.Len(); n != 0 {
		t.Errorf("got %d warn-or-worse entries on a configured install; want none: %v", n, logs.All())
	}
}

// @scenario "a blank or whitespace secret counts as unconfigured"
func TestLoadConfig_BlankInternalSecretCountsAsUnconfigured(t *testing.T) {
	// .env.example ships the key with no value and compose passes a blank
	// line through as an empty string, so "present but blank" is the shape an
	// unconfigured install actually has. Whitespace is the same intent typed
	// less carefully. Either reaching the router as a secret would make the
	// engine demand a value nothing can present and refuse every request the
	// app makes.
	for _, raw := range []string{"", "   ", "\t\n"} {
		t.Setenv("LANGWATCH_NLP_INTERNAL_SECRET", raw)

		cfg, err := LoadConfig(context.Background())
		if err != nil {
			t.Fatalf("LoadConfig(%q): %v", raw, err)
		}
		if cfg.InternalSecret != "" {
			t.Errorf("InternalSecret = %q for input %q; want empty so the install keeps serving",
				cfg.InternalSecret, raw)
		}
	}
}

// @scenario "a request carrying the configured secret is served"
func TestLoadConfig_SurroundingWhitespaceIsTrimmedFromTheSecret(t *testing.T) {
	// A value pasted into a .env or a Secret commonly arrives with a trailing
	// newline. Keeping it would mean the engine expects a secret the app, which
	// trims its own copy, never sends.
	t.Setenv("LANGWATCH_NLP_INTERNAL_SECRET", "  shared-with-the-app\n")

	cfg, err := LoadConfig(context.Background())
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.InternalSecret != "shared-with-the-app" {
		t.Errorf("InternalSecret = %q; want the trimmed value", cfg.InternalSecret)
	}
}

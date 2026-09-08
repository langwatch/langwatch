package domain

import (
	"strings"
	"testing"
)

// The URL-bearing overlay keys env.mjs validates as URLs. An empty assignment
// for any of them is still "set" to the Node loader and clobbers .env.
var overlayURLKeys = []string{
	"BASE_HOST", "NEXTAUTH_URL", "LANGWATCH_ENDPOINT", "LANGWATCH_NLP_SERVICE", "LW_GATEWAY_PUBLIC_URL",
}

// The loopback lines derived from a port: a zero port would render as
// http://127.0.0.1:0, which nobody can dial.
var overlayLoopbackKeys = []string{
	"LANGWATCH_API_URL", "GATEWAY_CONTROL_PLANE_URL", "LW_GATEWAY_BASE_URL", "LW_GATEWAY_INTERNAL_URL", "LANGY_AGENT_URL",
}

var overlayPortKeys = []string{
	"LANGWATCH_APP_PORT", "LANGWATCH_API_PORT", "LANGWATCH_GATEWAY_PORT", "LANGWATCH_NLP_PORT", "WORKER_METRICS_PORT",
}

func TestOverlayOnUnregisteredStackFallsThroughToDotenv(t *testing.T) {
	// `haven db reset` / `db seed` on a worktree with no running stack build
	// exactly this: a slug and a redis index, no planned services, no ports.
	env := Stack{Slug: "x", RedisDB: 1}.OverlayEnv()

	t.Run("emits no empty value", func(t *testing.T) {
		for _, line := range env {
			key, val, ok := strings.Cut(line, "=")
			if !ok || val == "" {
				t.Errorf("overlay emitted %q — an empty assignment still overrides .env", key)
			}
		}
	})
	t.Run("emits none of the URL keys", func(t *testing.T) {
		for _, key := range overlayURLKeys {
			if keyPresent(env, key) {
				t.Errorf("overlay emitted %s=%q on a stack with no services", key, valueOf(env, key))
			}
		}
	})
	t.Run("emits no loopback URL for a zero port", func(t *testing.T) {
		for _, key := range overlayLoopbackKeys {
			if keyPresent(env, key) {
				t.Errorf("overlay emitted %s=%q on a stack with no ports", key, valueOf(env, key))
			}
		}
	})
	t.Run("emits no zero port", func(t *testing.T) {
		for _, key := range overlayPortKeys {
			if keyPresent(env, key) {
				t.Errorf("overlay emitted %s=%q on a stack with no ports", key, valueOf(env, key))
			}
		}
	})
	t.Run("keeps the non-URL identity lines", func(t *testing.T) {
		for key, want := range map[string]string{
			"LANGWATCH_PORTLESS": "1", "LANGWATCH_SLUG": "x", "REDIS_DB_INDEX": "1", "LOG_FORMAT": "pretty",
			"LANGWATCH_DEFAULT_RETENTION_DAYS": "7",
		} {
			if got := valueOf(env, key); got != want {
				t.Errorf("%s = %q, want %q", key, got, want)
			}
		}
	})
}

func TestOverlayOnPlannedStackStillEmitsURLs(t *testing.T) {
	st := Stack{
		Slug: "x", RedisDB: 1, APIPort: 41001, WorkerMetricsPort: 41002,
		Services: []Service{
			{Name: "app", Port: 40000, URL: "https://app.x.langwatch.localhost"},
			{Name: "gateway", Port: 40001, URL: "https://gateway.x.langwatch.localhost"},
			{Name: "nlp", Port: 40002, URL: "https://nlp.x.langwatch.localhost"},
		},
	}
	env := st.OverlayEnv()
	for key, want := range map[string]string{
		"BASE_HOST":                 "https://app.x.langwatch.localhost",
		"NEXTAUTH_URL":              "https://app.x.langwatch.localhost",
		"LANGWATCH_ENDPOINT":        "https://app.x.langwatch.localhost",
		"LANGWATCH_NLP_SERVICE":     "https://nlp.x.langwatch.localhost",
		"LW_GATEWAY_PUBLIC_URL":     "https://gateway.x.langwatch.localhost",
		"LANGWATCH_API_URL":         "http://127.0.0.1:41001",
		"GATEWAY_CONTROL_PLANE_URL": "http://127.0.0.1:41001",
		"LW_GATEWAY_BASE_URL":       "http://127.0.0.1:41001",
		"LW_GATEWAY_INTERNAL_URL":   "http://127.0.0.1:40001",
		"LANGWATCH_APP_PORT":        "40000",
		"LANGWATCH_API_PORT":        "41001",
		"LANGWATCH_GATEWAY_PORT":    "40001",
		"LANGWATCH_NLP_PORT":        "40002",
		"WORKER_METRICS_PORT":       "41002",
	} {
		if got := valueOf(env, key); got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
}

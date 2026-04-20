package config

import (
	"strings"
	"testing"
)

func TestLogFieldsRedactsSecrets(t *testing.T) {
	c := &Config{
		ControlPlane: ControlPlane{
			InternalSecret:    "super-secret-do-not-log",
			JWTSecret:         "jwt-secret-32-bytes",
			JWTSecretPrevious: "",
		},
		AdminAuthToken: "admin-token",
		Cache:          Cache{RedisURL: "redis://:password@host:6379/0"},
	}
	fields := c.LogFields()
	// Slog-style even-length key/value pairs; turn into map for lookup.
	got := map[string]any{}
	for i := 0; i < len(fields); i += 2 {
		got[fields[i].(string)] = fields[i+1]
	}

	secrets := []string{"super-secret-do-not-log", "jwt-secret-32-bytes", "admin-token", "password"}
	for _, s := range secrets {
		for k, v := range got {
			if sv, ok := v.(string); ok && strings.Contains(sv, s) {
				t.Errorf("secret value leaked through field %q: %q", k, sv)
			}
		}
	}

	cases := map[string]string{
		"control_plane_internal_secret":     "set(len=23)",
		"control_plane_jwt_secret":          "set(len=19)",
		"control_plane_jwt_secret_previous": "unset",
		"admin_auth_token":                  "set(len=11)",
	}
	for k, want := range cases {
		if got[k] != want {
			t.Errorf("field %q = %v, want %q", k, got[k], want)
		}
	}
}

func TestRedactDistinguishesSetFromUnset(t *testing.T) {
	if got := redact(""); got != "unset" {
		t.Errorf("empty redact=%q want unset", got)
	}
	if got := redact("abc"); got != "set(len=3)" {
		t.Errorf("short redact=%q want set(len=3)", got)
	}
}

package config

import (
	"strings"
	"testing"
)

func baseValid() *Config {
	return &Config{
		ListenAddr: ":5563",
		AdminAddr:  "127.0.0.1:6060",
		ControlPlane: ControlPlane{
			BaseURL:        "http://langwatch-app:3000",
			InternalSecret: "s",
			JWTSecret:      "j",
		},
		Cache: Cache{LRUSize: 1},
	}
}

func TestValidateAdminAddrLoopbackAllowsEmptyToken(t *testing.T) {
	cfg := baseValid()
	for _, addr := range []string{"127.0.0.1:6060", "[::1]:6060", "localhost:6060", ""} {
		cfg.AdminAddr = addr
		cfg.AdminAuthToken = ""
		if err := cfg.validate(); err != nil {
			t.Errorf("addr %q + empty token should be allowed, got %v", addr, err)
		}
	}
}

func TestValidateAdminAddrNonLoopbackRequiresToken(t *testing.T) {
	cfg := baseValid()
	cfg.AdminAddr = "0.0.0.0:6060"
	cfg.AdminAuthToken = ""
	err := cfg.validate()
	if err == nil {
		t.Fatal("expected error for non-loopback admin without token")
	}
	if !strings.Contains(err.Error(), "GATEWAY_ADMIN_AUTH_TOKEN") {
		t.Errorf("error should mention the env var, got %v", err)
	}
}

func TestValidateAdminAddrNonLoopbackAllowsWithToken(t *testing.T) {
	cfg := baseValid()
	cfg.AdminAddr = "0.0.0.0:6060"
	cfg.AdminAuthToken = "s3cret"
	if err := cfg.validate(); err != nil {
		t.Errorf("non-loopback with token should be allowed, got %v", err)
	}
}

func TestIsLoopbackHelper(t *testing.T) {
	cases := map[string]bool{
		"127.0.0.1:6060":          true,
		"[::1]:6060":              true,
		"localhost:6060":          true,
		"0.0.0.0:6060":            false,
		"10.0.0.1:6060":           false,
		":6060":                   false,
		"":                        false,
		"gateway.example.com:443": false,
	}
	for addr, want := range cases {
		if got := isLoopback(addr); got != want {
			t.Errorf("isLoopback(%q)=%v want %v", addr, got, want)
		}
	}
}

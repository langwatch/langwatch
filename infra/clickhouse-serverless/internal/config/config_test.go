package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoad_PasswordFileOverridesEnv(t *testing.T) {
	dir := t.TempDir()
	pwFile := filepath.Join(dir, "password")
	if err := os.WriteFile(pwFile, []byte("  from-file  \n"), 0600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CH_CPU", "2")
	t.Setenv("CH_RAM", "1Gi")
	t.Setenv("CLICKHOUSE_PASSWORD", "from-env")
	t.Setenv("CLICKHOUSE_PASSWORD_FILE", pwFile)

	input, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if input.Password != "from-file" {
		t.Errorf("Password = %q, want %q", input.Password, "from-file")
	}
}

func TestLoad_PasswordFileNotFound(t *testing.T) {
	t.Setenv("CH_CPU", "2")
	t.Setenv("CH_RAM", "1Gi")
	t.Setenv("CLICKHOUSE_PASSWORD", "pw")
	t.Setenv("CLICKHOUSE_PASSWORD_FILE", "/nonexistent/password")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error for nonexistent password file")
	}
}

func TestLoad_ExplicitCPUAndRAM(t *testing.T) {
	t.Setenv("CH_CPU", "4")
	t.Setenv("CH_RAM", "8Gi")
	t.Setenv("CLICKHOUSE_PASSWORD", "pw")

	input, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if input.CPU != 4 {
		t.Errorf("CPU = %d, want 4", input.CPU)
	}
	if input.RAMBytes != 8*1024*1024*1024 {
		t.Errorf("RAMBytes = %d, want %d", input.RAMBytes, 8*1024*1024*1024)
	}
}

func TestLoad_FallbackToDetect(t *testing.T) {
	// Unset CH_CPU and CH_RAM — Load falls back to cgroup/runtime detection.
	// On macOS, CPU falls back to runtime.NumCPU; RAM detection fails.
	t.Setenv("CH_CPU", "")
	t.Setenv("CH_RAM", "")
	t.Setenv("CLICKHOUSE_PASSWORD", "pw")

	// Explicitly set CH_RAM since DetectRAM() fails on macOS
	t.Setenv("CH_RAM", "2Gi")

	input, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if input.CPU < 1 {
		t.Errorf("CPU = %d, want >= 1", input.CPU)
	}
}

// @scenario "Dynamic-only mode starts without any password for the default user"
func TestLoad_ReadsTheModeFromTheAccessFile(t *testing.T) {
	t.Setenv("CH_CPU", "2")
	t.Setenv("CH_RAM", "1Gi")
	for _, tc := range []struct {
		file string
		want bool
	}{
		{"mode: dynamic-only\nusers: []\n", true},
		{"users: []\n", false},
	} {
		path := filepath.Join(t.TempDir(), "access.yaml")
		if err := os.WriteFile(path, []byte(tc.file), 0o600); err != nil {
			t.Fatal(err)
		}
		t.Setenv("CLICKHOUSE_ACCESS_FILE", path)
		i, err := Load()
		if err != nil {
			t.Fatalf("Load: %v", err)
		}
		if i.DynamicOnly != tc.want || i.AccessBootstrapDir != "/run/clickhouse-access" {
			t.Errorf("%q: DynamicOnly = %v, bootstrap dir %q", tc.file, i.DynamicOnly, i.AccessBootstrapDir)
		}
	}

	t.Run("an invalid access file stops Load", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "access.yaml")
		_ = os.WriteFile(path, []byte("mode: dynamic-only\nusers: [{name: m, tier: inspect, login: {rolling: {dir: /x}}}]\n"), 0o600)
		t.Setenv("CLICKHOUSE_ACCESS_FILE", path)
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "refused in dynamic-only mode") {
			t.Errorf("Load = %v, want the rolling user refused", err)
		}
	})
}

package config

import (
	"os"
	"path/filepath"
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

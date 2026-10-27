package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/matrixseed"
)

func TestWriteExportsAppendsToTheEnvFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "github_env")
	if err := os.WriteFile(path, []byte("EARLIER=1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeExports(path, []matrixseed.Export{{Name: "TEST_VK_OPENAI", Value: "vk-1"}}); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if want := "EARLIER=1\nTEST_VK_OPENAI=vk-1\n"; string(got) != want {
		t.Errorf("env file = %q, want %q", got, want)
	}
}

func TestWriteExportsRefusesAValueWithALineBreak(t *testing.T) {
	path := filepath.Join(t.TempDir(), "github_env")
	if err := writeExports(path, []matrixseed.Export{{Name: "TEST_VK_OPENAI", Value: "a\nINJECTED=1"}}); err == nil {
		t.Fatal("a value with a line break was written to the env file")
	}
}

func TestEnvOrFallsBackOnlyWhenUnset(t *testing.T) {
	t.Setenv("MATRIXSEED_TEST_VALUE", "")
	if got := envOr("MATRIXSEED_TEST_VALUE", "fallback"); got != "fallback" {
		t.Errorf("unset: got %q", got)
	}
	t.Setenv("MATRIXSEED_TEST_VALUE", "set")
	if got := envOr("MATRIXSEED_TEST_VALUE", "fallback"); got != "set" {
		t.Errorf("set: got %q", got)
	}
}

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/matrixseed"
)

// TestWriteExportsAppendsToTheEnvFile: earlier steps' variables live in the same
// GITHUB_ENV, so truncating it would unset them for the rest of the job.
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

// TestWriteExportsRefusesAValueWithALineBreak stops a value injecting a variable.
func TestWriteExportsRefusesAValueWithALineBreak(t *testing.T) {
	path := filepath.Join(t.TempDir(), "github_env")
	if err := writeExports(path, []matrixseed.Export{{Name: "TEST_VK_OPENAI", Value: "a\nINJECTED=1"}}); err == nil {
		t.Fatal("a value with a line break was written to the env file")
	}
}

// TestEnvOrFallsBackOnlyWhenUnset: the job's LW_BASE_URL must win, or the seed
// would talk to the default port while the api listens elsewhere.
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

// TestWriteBootstrappedAppendsTheStepOutput: the gateway and matrix steps run
// only on this line, and other outputs share the file.
/** @scenario "The gateway and matrix run only once the seed has bootstrapped" */
func TestWriteBootstrappedAppendsTheStepOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "github_output")
	if err := os.WriteFile(path, []byte("EARLIER=1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeBootstrapped(path); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if want := "EARLIER=1\nbootstrapped=true\n"; string(got) != want {
		t.Errorf("output file = %q, want %q", got, want)
	}
}

// TestWriteBootstrappedWithNoPathWritesNothing: run by hand there is no
// GITHUB_OUTPUT, and that must not fail a seed that worked.
func TestWriteBootstrappedWithNoPathWritesNothing(t *testing.T) {
	if err := writeBootstrapped(""); err != nil {
		t.Fatal(err)
	}
}

// TestRefusedBootstrapWritesNoBootstrappedOutput leaves the gateway and matrix
// steps gated off when the control plane refuses the organization.
/** @scenario "The gateway and matrix run only once the seed has bootstrapped" */
func TestRefusedBootstrapWritesNoBootstrappedOutput(t *testing.T) {
	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "no", http.StatusForbidden)
	}))
	t.Cleanup(refusing.Close)
	dir := t.TempDir()
	envFile, outputFile := filepath.Join(dir, "github_env"), filepath.Join(dir, "github_output")
	opts := matrixseed.Options{BaseURL: refusing.URL, InstanceAdminKey: "admin", Env: func(string) string { return "" }}
	if code := seed(context.Background(), opts, files{env: envFile, output: outputFile}); code != 1 {
		t.Fatalf("a refused bootstrap must fail the step, got exit %d", code)
	}
	got, _ := os.ReadFile(outputFile)
	if strings.Contains(string(got), "bootstrapped") {
		t.Fatalf("a refused bootstrap wrote %q to the step output", got)
	}
}

// TestProviderRefusalStillBootstraps: a refused provider fails the step, yet
// the project exists, so the gateway and matrix must still run on the rest.
/** @scenario "The gateway and matrix run only once the seed has bootstrapped" */
func TestProviderRefusalStillBootstraps(t *testing.T) {
	plane := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/organizations":
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"organization": map[string]any{"id": "org_1"}, "team": map[string]any{"id": "team_1"},
				"adminApiKey": map[string]any{"id": "key_1", "token": "admin-key"},
			})
		case "/api/v1/projects":
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "project_1", "serviceApiKey": "project-key", "serviceApiKeyId": "key_2"})
		default:
			http.Error(w, `{"error":"refused"}`, http.StatusBadRequest)
		}
	}))
	t.Cleanup(plane.Close)
	dir := t.TempDir()
	out := files{env: filepath.Join(dir, "github_env"), output: filepath.Join(dir, "github_output")}
	env := map[string]string{"OPENAI_API_KEY": "sk-test"}
	opts := matrixseed.Options{BaseURL: plane.URL, InstanceAdminKey: "admin", Env: func(k string) string { return env[k] }}
	if code := seed(context.Background(), opts, out); code != 1 {
		t.Fatalf("a refused provider must fail the step, got exit %d", code)
	}
	got, _ := os.ReadFile(out.output)
	if !strings.Contains(string(got), "bootstrapped=true") {
		t.Fatalf("a seeded project must still set bootstrapped=true, output file = %q", got)
	}
}

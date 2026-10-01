package visualdiff

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeEnv(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(body), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	return dir
}

func readEnv(t *testing.T, dir string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, ".env"))
	if err != nil {
		t.Fatalf("read .env: %v", err)
	}
	return string(raw)
}

// @scenario "A placeholder gateway secret is substituted in the worktree's own .env"
func TestPlaceholderGatewaySecretsAreSubstituted(t *testing.T) {
	t.Run("given a copied .env whose gateway trio carries short placeholders", func(t *testing.T) {
		t.Run("when the worktree is prepared", func(t *testing.T) {
			dir := writeEnv(t, "LW_GATEWAY_INTERNAL_SECRET=\"short\"\nLW_GATEWAY_JWT_SECRET=\nLW_VIRTUAL_KEY_PEPPER=abc\nOTHER=keep\n")

			substituted, err := EnsureGatewaySecrets(dir, "20260913-000000")
			if err != nil {
				t.Fatalf("EnsureGatewaySecrets: %v", err)
			}
			if len(substituted) != len(GatewaySecretKeys) {
				t.Fatalf("all three are substituted together: got %v", substituted)
			}

			body := readEnv(t, dir)
			for _, key := range GatewaySecretKeys {
				if value := readEnvValue(body, key); len(value) < MinGatewaySecretLength {
					t.Errorf("%s = %q, want at least %d characters", key, value, MinGatewaySecretLength)
				}
			}
			if !strings.Contains(body, "OTHER=keep") {
				t.Error("an unrelated variable must survive untouched")
			}
			if !strings.Contains(body, "# visualdiff replaced this placeholder") {
				t.Error("the developer's own line is commented, not deleted")
			}
		})
	})
}

// @scenario "A real gateway secret is never replaced"
func TestUsableGatewaySecretsAreLeftAlone(t *testing.T) {
	t.Run("given a .env whose gateway trio already passes the gateway's own check", func(t *testing.T) {
		t.Run("when the worktree is prepared", func(t *testing.T) {
			real := strings.Repeat("a", MinGatewaySecretLength)
			body := ""
			for _, key := range GatewaySecretKeys {
				body += key + "=" + real + "\n"
			}
			dir := writeEnv(t, body)

			substituted, err := EnsureGatewaySecrets(dir, "20260913-000000")
			if err != nil {
				t.Fatalf("EnsureGatewaySecrets: %v", err)
			}
			if len(substituted) != 0 {
				t.Fatalf("nothing is substituted when the developer's own values pass: %v", substituted)
			}
			if readEnv(t, dir) != body {
				t.Error("the file must not be rewritten at all")
			}
		})
	})
}

// @scenario "Both stacks of a run substitute the same value"
func TestSubstitutedSecretsAgreeAcrossStacks(t *testing.T) {
	t.Run("given two worktrees of the same run", func(t *testing.T) {
		t.Run("when each is prepared", func(t *testing.T) {
			base, candidate := writeEnv(t, "LW_GATEWAY_JWT_SECRET=\n"), writeEnv(t, "LW_GATEWAY_JWT_SECRET=\n")
			if _, err := EnsureGatewaySecrets(base, "20260913-000000"); err != nil {
				t.Fatalf("base: %v", err)
			}
			if _, err := EnsureGatewaySecrets(candidate, "20260913-000000"); err != nil {
				t.Fatalf("candidate: %v", err)
			}
			key := "LW_GATEWAY_JWT_SECRET"
			if readEnvValue(readEnv(t, base), key) != readEnvValue(readEnv(t, candidate), key) {
				t.Error("a substituted secret must never be the reason two screens differ")
			}
		})
	})
}

// @scenario "A worktree with no .env is left alone"
func TestMissingEnvIsNotCreated(t *testing.T) {
	t.Run("given a worktree the developer had no .env to copy into", func(t *testing.T) {
		t.Run("when the worktree is prepared", func(t *testing.T) {
			dir := t.TempDir()
			substituted, err := EnsureGatewaySecrets(dir, "20260913-000000")
			if err != nil {
				t.Fatalf("a missing .env is not an error: %v", err)
			}
			if len(substituted) != 0 {
				t.Fatalf("nothing to substitute into: %v", substituted)
			}
			if _, err := os.Stat(filepath.Join(dir, ".env")); !os.IsNotExist(err) {
				t.Error("visualdiff must not author a .env that the developer does not have")
			}
		})
	})
}

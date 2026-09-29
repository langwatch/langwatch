package visualdiff

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// @scenario "A monolith base runs its workers and names every seeded admin an operator"
func TestAMonolithBaseRunsItsWorkersAndNamesEverySeededAdminAnOperator(t *testing.T) {
	t.Run("given a monolith worktree whose app directory holds the copied .env", func(t *testing.T) {
		dir := t.TempDir()
		appDir := filepath.Join(dir, "platform", "app")
		if err := os.MkdirAll(appDir, 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(appDir, ".env"), []byte("KEEP=1\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		t.Run("when the worktree is prepared", func(t *testing.T) {
			if err := PinMonolithDotenv(dir); err != nil {
				t.Fatalf("PinMonolithDotenv: %v", err)
			}
			data, err := os.ReadFile(filepath.Join(appDir, ".env"))
			if err != nil {
				t.Fatal(err)
			}
			got := string(data)
			t.Run("then the app runs its workers in-process", func(t *testing.T) {
				if !strings.Contains(got, "\nWORKERS_IN_PROCESS=1\n") {
					t.Errorf("app .env = %q, want WORKERS_IN_PROCESS=1", got)
				}
			})
			t.Run("and both the current and the retired seeded admin are operators", func(t *testing.T) {
				if !strings.Contains(got, "\nADMIN_EMAILS=admin@mail.langwatch.localhost,admin@haven.localhost\n") {
					t.Errorf("app .env = %q, want both seeded admins in ADMIN_EMAILS", got)
				}
			})
			t.Run("and the developer's own lines survive", func(t *testing.T) {
				if !strings.HasPrefix(got, "KEEP=1\n") {
					t.Errorf("app .env = %q, want the copied lines kept first", got)
				}
			})
		})
	})

	t.Run("given a monolith worktree with no .env to copy", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.MkdirAll(filepath.Join(dir, "platform", "app"), 0o750); err != nil {
			t.Fatal(err)
		}
		t.Run("when the worktree is prepared, then the app .env is created with the pins", func(t *testing.T) {
			if err := PinMonolithDotenv(dir); err != nil {
				t.Fatalf("PinMonolithDotenv: %v", err)
			}
			data, err := os.ReadFile(filepath.Join(dir, "platform", "app", ".env"))
			if err != nil || !strings.Contains(string(data), "WORKERS_IN_PROCESS=1") {
				t.Errorf("app .env = %q (%v), want it created with the pins", data, err)
			}
		})
	})

	t.Run("given a modular worktree, when it is prepared, then nothing is written", func(t *testing.T) {
		dir := t.TempDir()
		if err := PinMonolithDotenv(dir); err != nil {
			t.Fatalf("PinMonolithDotenv: %v", err)
		}
		if _, err := os.Stat(filepath.Join(dir, "platform")); !os.IsNotExist(err) {
			t.Errorf("modular worktree gained %s (%v), want nothing written", filepath.Join(dir, "platform"), err)
		}
	})
}

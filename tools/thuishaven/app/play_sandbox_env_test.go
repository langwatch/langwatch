package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// A play sandbox runs code nobody has reviewed. This repo's post-checkout hook
// copies the developer's untracked .env files into every new worktree — live
// provider keys, Stripe and auth secrets, shared-dev connection strings — none of
// which the stack's own overlay supplies. Inheriting them would hand the lot to
// the PR while the sandbox banner promises the opposite.
//
// @scenario "The sandbox never inherits the developer's env files"
// @scenario "A working PR checkout still gets the env files it has always had"
func TestPlayCheckoutDoesNotInheritTheDevelopersEnvFiles(t *testing.T) {
	t.Run("given a checkout that must not inherit env files", func(t *testing.T) {
		t.Run("when building the git worktree argv", func(t *testing.T) {
			args := worktreeAddArgs("/tmp/play/pr-1", "haven-play-1", false)

			// git fires post-checkout on `worktree add` with the branch flag set, so
			// the hook runs unless it is disabled at the invocation.
			if !hasAdjacentPair(args, "-c", "core.hooksPath=/dev/null") {
				t.Errorf("argv = %q, want the hooks disabled via -c core.hooksPath=/dev/null", args)
			}
			if idx := indexOf(args, "worktree"); idx == -1 || args[idx+1] != "add" {
				t.Errorf("argv = %q, want it to still be a worktree add", args)
			}
		})
	})

	t.Run("given a haven pr checkout, which is the developer's own working tree", func(t *testing.T) {
		t.Run("when building the git worktree argv", func(t *testing.T) {
			args := worktreeAddArgs("/tmp/pr-1", "pr-1", true)

			// `haven pr` has always relied on the hook to seed a usable worktree;
			// suppressing it there would be a silent regression of that command.
			if hasAdjacentPair(args, "-c", "core.hooksPath=/dev/null") {
				t.Errorf("argv = %q, want the hook left enabled for haven pr", args)
			}
		})
	})
}

// The hook suppression is one layer. The sweep is the other, and it is the one
// that also covers a refreshed checkout, a sandbox left behind by an older haven,
// and any future hook that copies secrets in by a different route.
func TestStripInheritedEnvFilesRemovesUntrackedSecretsAndKeepsTheReposOwn(t *testing.T) {
	t.Run("given a checkout carrying both an inherited .env and the repo's tracked .env.example", func(t *testing.T) {
		checkout := t.TempDir()
		gitInit(t, checkout)

		mustWrite(t, filepath.Join(checkout, "langwatch"), ".env.example", "OPENAI_API_KEY=\n")
		gitAddCommit(t, checkout, "langwatch/.env.example")

		// What the hook would have copied in.
		mustWrite(t, filepath.Join(checkout, "langwatch"), ".env", "OPENAI_API_KEY=sk-real-secret\n")
		mustWrite(t, filepath.Join(checkout, "langwatch"), ".env.portless", "DATABASE_URL=postgres://real\n")
		mustWrite(t, filepath.Join(checkout, "python-sdk"), ".env", "ANTHROPIC_API_KEY=sk-ant-real\n")
		mustWrite(t, checkout, ".env", "STRIPE_SECRET_KEY=sk_live_real\n")

		t.Run("when the sandbox strips inherited env files", func(t *testing.T) {
			if err := StripInheritedEnvFiles(checkout); err != nil {
				t.Fatalf("StripInheritedEnvFiles: %v", err)
			}

			for _, gone := range []string{
				filepath.Join("langwatch", ".env"),
				filepath.Join("langwatch", ".env.portless"),
				filepath.Join("python-sdk", ".env"),
				".env",
			} {
				if _, err := os.Stat(filepath.Join(checkout, gone)); !os.IsNotExist(err) {
					t.Errorf("%s survived into the sandbox; it carries the developer's secrets", gone)
				}
			}

			// Tracked files are the repo's own content, not the developer's: removing
			// them would dirty the checkout and change what the PR's code sees.
			if _, err := os.Stat(filepath.Join(checkout, "langwatch", ".env.example")); err != nil {
				t.Errorf("tracked .env.example was removed: %v", err)
			}
		})
	})

	t.Run("given a checkout with no env files at all", func(t *testing.T) {
		checkout := t.TempDir()
		gitInit(t, checkout)

		t.Run("when the sandbox strips inherited env files", func(t *testing.T) {
			if err := StripInheritedEnvFiles(checkout); err != nil {
				t.Errorf("StripInheritedEnvFiles on a clean checkout = %v, want no error", err)
			}
		})
	})
}

func hasAdjacentPair(args []string, first, second string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == first && args[i+1] == second {
			return true
		}
	}
	return false
}

func indexOf(args []string, want string) int {
	for i, a := range args {
		if a == want {
			return i
		}
	}
	return -1
}

func mustWrite(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", dir, err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatalf("write %s/%s: %v", dir, name, err)
	}
}

func gitInit(t *testing.T, dir string) {
	t.Helper()
	for _, args := range [][]string{
		{"init", "-q"},
		{"config", "user.email", "haven@test.local"},
		{"config", "user.name", "haven test"},
		// The developer's global config may sign every commit; this fixture has no key.
		{"config", "commit.gpgsign", "false"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v (%s)", args, err, out)
		}
	}
}

func gitAddCommit(t *testing.T, dir, path string) {
	t.Helper()
	for _, args := range [][]string{
		{"add", path},
		{"commit", "-q", "-m", "fixture"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v (%s)", args, err, out)
		}
	}
}

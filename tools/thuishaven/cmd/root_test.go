package cmd

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestStripFlag(t *testing.T) {
	t.Run("when the flag is present", func(t *testing.T) {
		out, found := stripFlag([]string{"a", "--force", "b"}, "--force")
		if !found {
			t.Fatal("stripFlag did not report the flag as found")
		}
		if got, want := len(out), 2; got != want {
			t.Fatalf("remaining args = %q, want length %d", out, want)
		}
		if out[0] != "a" || out[1] != "b" {
			t.Errorf("stripFlag left %q, want [a b]", out)
		}
	})
	t.Run("when the flag is absent", func(t *testing.T) {
		out, found := stripFlag([]string{"a", "b"}, "--force")
		if found {
			t.Error("stripFlag reported an absent flag as found")
		}
		if len(out) != 2 {
			t.Errorf("stripFlag changed args to %q", out)
		}
	})
}

func TestPRWorktreeBaseHonoursEnvOverride(t *testing.T) {
	t.Setenv("HAVEN_WORKTREE_DIR", "/tmp/custom-worktrees")
	if got, want := prWorktreeBase("/anywhere"), "/tmp/custom-worktrees"; got != want {
		t.Errorf("prWorktreeBase = %q, want the HAVEN_WORKTREE_DIR override %q", got, want)
	}
}

func TestPRWorktreeBaseDefaultsToSiblingWorktreesDir(t *testing.T) {
	t.Setenv("HAVEN_WORKTREE_DIR", "")
	repo := gitInitTemp(t)
	// Default base is the sibling worktrees/ dir next to the main checkout. git
	// reports the symlink-resolved checkout path (e.g. /private/var on macOS), so
	// resolve the expected side too rather than comparing raw temp paths.
	resolved, err := filepath.EvalSymlinks(repo)
	if err != nil {
		t.Fatalf("EvalSymlinks(repo) = %v", err)
	}
	if got, want := prWorktreeBase(repo), filepath.Join(filepath.Dir(resolved), "worktrees"); got != want {
		t.Errorf("prWorktreeBase(%q) = %q, want %q", repo, got, want)
	}
}

func TestGitMainWorktreeReturnsPrimaryCheckout(t *testing.T) {
	repo := gitInitTemp(t)
	got, err := filepath.EvalSymlinks(gitMainWorktree(repo))
	if err != nil {
		t.Fatalf("EvalSymlinks(gitMainWorktree) = %v", err)
	}
	want, err := filepath.EvalSymlinks(repo)
	if err != nil {
		t.Fatalf("EvalSymlinks(repo) = %v", err)
	}
	if got != want {
		t.Errorf("gitMainWorktree = %q, want the primary checkout %q", got, want)
	}
}

// gitInitTemp makes a throwaway git repo with one commit, isolated from the
// developer's global/system git config, and returns its path.
func gitInitTemp(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_CONFIG_GLOBAL=/dev/null",
			"GIT_CONFIG_SYSTEM=/dev/null",
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init")
	run("commit", "--allow-empty", "-m", "init")
	return dir
}

// @scenario "The managed ClickHouse keeps its own telemetry lightweight"
func TestClickHouseLimitsEnvWiring(t *testing.T) {
	t.Run("given no ClickHouse log env vars", func(t *testing.T) {
		t.Setenv("HAVEN_CLICKHOUSE_FULL_LOGS", "")
		t.Setenv("HAVEN_CLICKHOUSE_LOG_TTL_DAYS", "")

		t.Run("when resolving the limits", func(t *testing.T) {
			l := clickHouseLimits()

			t.Run("keeps lightweight logs on by default", func(t *testing.T) {
				if !l.LightweightLogsEnabled {
					t.Error("lightweight logs off without any env opt-out")
				}
			})
		})
	})

	t.Run("given HAVEN_CLICKHOUSE_FULL_LOGS=1", func(t *testing.T) {
		t.Setenv("HAVEN_CLICKHOUSE_FULL_LOGS", "1")

		t.Run("when resolving the limits", func(t *testing.T) {
			t.Run("restores full stock logging", func(t *testing.T) {
				if clickHouseLimits().LightweightLogsEnabled {
					t.Error("FULL_LOGS=1 did not disable lightweight logs")
				}
			})
		})
	})

	t.Run("given HAVEN_CLICKHOUSE_FULL_LOGS=0", func(t *testing.T) {
		t.Setenv("HAVEN_CLICKHOUSE_FULL_LOGS", "0")

		t.Run("when resolving the limits", func(t *testing.T) {
			t.Run("keeps lightweight logs on — only a truthy value opts out", func(t *testing.T) {
				if !clickHouseLimits().LightweightLogsEnabled {
					t.Error("FULL_LOGS=0 disabled lightweight logs; the flag is documented as =1")
				}
			})
		})
	})

	t.Run("given HAVEN_CLICKHOUSE_LOG_TTL_DAYS=3", func(t *testing.T) {
		t.Setenv("HAVEN_CLICKHOUSE_LOG_TTL_DAYS", "3")

		t.Run("when resolving the limits", func(t *testing.T) {
			t.Run("carries the override into the TTL", func(t *testing.T) {
				if got := clickHouseLimits().SystemLogTTLDays; got != 3 {
					t.Errorf("got TTL %d, want 3", got)
				}
			})
		})
	})
}

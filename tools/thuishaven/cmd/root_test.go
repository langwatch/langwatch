package cmd

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestFirstNonFlag(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want string
	}{
		{"bare ref", []string{"4913"}, "4913"},
		{"flag then ref", []string{"--dry-run", "4913"}, "4913"},
		{"ref then flag", []string{"4913", "--force"}, "4913"},
		{"url ref", []string{"https://github.com/o/r/pull/1"}, "https://github.com/o/r/pull/1"},
		{"no args", nil, ""},
		{"only flags", []string{"--force", "--no-install"}, ""},
		// Non-obvious: a leading "-1" reads as a flag and is skipped, so it never
		// reaches gh. That's fine — looksLikePRRef rejects negatives anyway — but
		// pin it so the flag-vs-ref boundary can't drift silently.
		{"negative number is treated as a flag", []string{"-1"}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := firstNonFlag(tc.args); got != tc.want {
				t.Errorf("firstNonFlag(%q) = %q, want %q", tc.args, got, tc.want)
			}
		})
	}
}

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

func TestFlagValue(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want string
	}{
		{"space-separated value", []string{"--preset", "demo"}, "demo"},
		{"equals-embedded value", []string{"--preset=demo"}, "demo"},
		{"absent flag", []string{"--force"}, ""},
		{"no args", nil, ""},
		// A trailing --preset has no following value to return; the seed command
		// rejects this shape via seedPresetArg rather than silently defaulting.
		{"trailing flag without value", []string{"--preset"}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := flagValue(tc.args, "--preset"); got != tc.want {
				t.Errorf("flagValue(%q, --preset) = %q, want %q", tc.args, got, tc.want)
			}
		})
	}
}

func TestSeedPresetArg(t *testing.T) {
	t.Run("when --preset carries a value", func(t *testing.T) {
		for _, args := range [][]string{{"--preset", "demo"}, {"--preset=demo"}} {
			preset, err := seedPresetArg(args)
			if err != nil {
				t.Fatalf("seedPresetArg(%q) = %v, want nil error", args, err)
			}
			if preset != "demo" {
				t.Errorf("seedPresetArg(%q) = %q, want %q", args, preset, "demo")
			}
		}
	})
	t.Run("when no preset is given, it returns the default empty preset", func(t *testing.T) {
		preset, err := seedPresetArg(nil)
		if err != nil {
			t.Fatalf("seedPresetArg(nil) = %v, want nil error", err)
		}
		if preset != "" {
			t.Errorf("seedPresetArg(nil) = %q, want empty", preset)
		}
	})
	t.Run("when --preset trails without a value, it errors instead of seeding the default", func(t *testing.T) {
		if _, err := seedPresetArg([]string{"--preset"}); err == nil {
			t.Error("seedPresetArg accepted a trailing --preset with no value")
		}
	})
	t.Run("when the preset is passed positionally, it errors instead of ignoring it", func(t *testing.T) {
		if _, err := seedPresetArg([]string{"demo"}); err == nil {
			t.Error("seedPresetArg accepted a positional preset it would have ignored")
		}
	})
}

func TestHasFlag(t *testing.T) {
	if !hasFlag([]string{"4913", "--trusted"}, "--trusted") {
		t.Error("hasFlag missed a present flag")
	}
	if hasFlag([]string{"4913"}, "--trusted") {
		t.Error("hasFlag found an absent flag")
	}
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

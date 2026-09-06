package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestLooksLikePRRef(t *testing.T) {
	cases := map[string]bool{
		"4913": true,
		"1":    true,
		"https://github.com/langwatch/langwatch/pull/4913": true,
		"github.com/langwatch/langwatch/pull/1":            true,
		"":                                                 false,
		"0":                                                false, // no PR #0
		"-1":                                               false, // a negative "number" is not a ref
		"main":                                             false,
		"feat/x":                                           false,
		"https://example.com/foo":                          false, // a URL, but not a PR one
	}
	for in, want := range cases {
		if got := looksLikePRRef(in); got != want {
			t.Errorf("looksLikePRRef(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestPRWorktreePathAndBranchAreDeterministic(t *testing.T) {
	base := filepath.Join("/Users", "x", "langwatch", "worktrees")

	// The dir name pr-<n> sanitises to the slug pr-<n> → app.pr-<n>.langwatch.localhost.
	if got, want := prWorktreePath(base, 4913), filepath.Join(base, "pr-4913"); got != want {
		t.Errorf("prWorktreePath = %q, want %q", got, want)
	}
	// Namespaced so it never collides with a real branch called 4913.
	if got, want := prBranchName(4913), "haven-pr-4913"; got != want {
		t.Errorf("prBranchName = %q, want %q", got, want)
	}
}

// TestRefreshAutostashesInsteadOfLosingLocalEdits pins the data-loss fix: a reused
// PR worktree with uncommitted tracked edits must not have them silently discarded
// by the refresh's `git reset --hard`. Instead they're autostashed and remain
// recoverable. Exercises the real git path, not just string helpers.
func TestRefreshAutostashesInsteadOfLosingLocalEdits(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	dir := t.TempDir()
	git := gitRunner(t, dir)
	git("init")
	// Repo-local identity so the production code's `git stash` (which runs with the
	// ambient env, not gitRunner's) can create its commit even in a clean CI.
	git("config", "user.name", "t")
	git("config", "user.email", "t@t")
	writeTestFile(t, dir, "file.txt", "orig\n")
	git("add", "file.txt")
	git("commit", "-m", "init")

	ctx := context.Background()

	// A clean tree has nothing to stash.
	if dirty, err := worktreeHasTrackedChanges(ctx, dir); err != nil || dirty {
		t.Fatalf("clean tree: dirty=%v err=%v, want false, nil", dirty, err)
	}

	// A tracked edit a developer made while poking at the PR.
	writeTestFile(t, dir, "file.txt", "my debugging change\n")
	if dirty, err := worktreeHasTrackedChanges(ctx, dir); err != nil || !dirty {
		t.Fatalf("edited tree: dirty=%v err=%v, want true, nil", dirty, err)
	}

	// Autostash tucks the edit away, returning the working tree to HEAD.
	if err := autostashLocalChanges(ctx, dir, 5743); err != nil {
		t.Fatalf("autostashLocalChanges: %v", err)
	}
	if dirty, err := worktreeHasTrackedChanges(ctx, dir); err != nil || dirty {
		t.Fatalf("after autostash: dirty=%v err=%v, want clean", dirty, err)
	}
	if got := readTestFile(t, dir, "file.txt"); got != "orig\n" {
		t.Fatalf("file after autostash = %q, want committed %q", got, "orig\n")
	}

	// The edit is not lost — it's a recoverable, labelled stash entry.
	if list := git("stash", "list"); !strings.Contains(list, "haven pr 5743") {
		t.Fatalf("stash list = %q, want a 'haven pr 5743' entry", list)
	}
	git("stash", "apply")
	if got := readTestFile(t, dir, "file.txt"); got != "my debugging change\n" {
		t.Fatalf("file after stash apply = %q, want the recovered edit", got)
	}
}

// gitRunner returns a helper that runs git in dir, isolated from the developer's
// global/system config, and fails the test on any git error.
func gitRunner(t *testing.T, dir string) func(args ...string) string {
	t.Helper()
	return func(args ...string) string {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t",
		)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return string(out)
	}
}

func writeTestFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func readTestFile(t *testing.T, dir, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(b)
}

func TestPorcelainIsDirty(t *testing.T) {
	cases := map[string]bool{
		"":                       false, // clean tree
		"\n":                     false, // git can emit a trailing newline
		"   \n":                  false, // only whitespace
		" M src/app.ts\n":        true,  // unstaged modification
		"M  src/app.ts\n":        true,  // staged modification
		"A  new.go\nD  old.go\n": true,  // multiple entries
	}
	for status, want := range cases {
		if got := porcelainIsDirty(status); got != want {
			t.Errorf("porcelainIsDirty(%q) = %v, want %v", status, got, want)
		}
	}
}

func TestPnpmInstallArgs(t *testing.T) {
	sameRepo := prView{IsCrossRepository: false}
	fork := prView{IsCrossRepository: true}

	cases := []struct {
		name         string
		view         prView
		allowScripts bool
		want         []string
	}{
		// A fork controls package scripts, and this repo has a postinstall — its
		// install must not run lifecycle scripts unless explicitly trusted.
		{"untrusted fork is sanitized", fork, false, []string{"install", "--ignore-scripts"}},
		{"trusted fork runs scripts", fork, true, []string{"install"}},
		// Same-repo PRs are as trusted as the base; --trusted is a no-op for them.
		{"same-repo installs normally", sameRepo, false, []string{"install"}},
		{"same-repo with --trusted", sameRepo, true, []string{"install"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pnpmInstallArgs(tc.view, tc.allowScripts); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("pnpmInstallArgs(%+v, %v) = %q, want %q",
					tc.view, tc.allowScripts, got, tc.want)
			}
		})
	}
}

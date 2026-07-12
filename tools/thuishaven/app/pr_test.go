package app

import (
	"path/filepath"
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

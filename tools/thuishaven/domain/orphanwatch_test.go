package domain

import "testing"

func TestIsOrphanCandidate(t *testing.T) {
	cases := map[string]bool{
		"sh -c while true; do node src/app.entrypoint.ts; done":               true,
		"node --experimental-transform-types src/app.entrypoint.ts":           true,
		"/Users/x/.cache/node/corepack/v1/pnpm/12.6.0/pnpm-native --filter x": true,
		"-zsh":                                 false,
		"bash":                                 false,
		"/Users/x/go/bin/haven keep w --agent": false,
		"node /usr/local/bin/claude":           false,
		"node /usr/local/bin/codex exec":       false,
		"tsgo --lsp --stdio":                   false,
		"node /w/node_modules/nx/src/daemon/server/start.js": false,
		"/usr/bin/python3 server.py":                         false,
	}
	for command, want := range cases {
		if got := IsOrphanCandidate(command); got != want {
			t.Errorf("IsOrphanCandidate(%q) = %v, want %v", command, got, want)
		}
	}
}

func TestUnderRootsAndMentionsRoot(t *testing.T) {
	roots := []string{"/w"}
	if !UnderRoots("/w/.worktrees/x", roots) || UnderRoots("/wx", roots) || UnderRoots("", roots) {
		t.Fatal("UnderRoots must match the root and paths beneath it only")
	}
	if !MentionsRoot("node /w/node_modules/.bin/vite", roots) || MentionsRoot("node vite", roots) {
		t.Fatal("MentionsRoot must match an absolute path under a root only")
	}
}

package domain

import "testing"

func TestNxDaemonWorktreeReadsTheCheckoutOffTheCommand(t *testing.T) {
	cases := []struct {
		command, want string
		ok            bool
	}{
		{"/opt/homebrew/bin/node /w/lw/node_modules/.pnpm/nx@23.2.1/node_modules/nx/dist/src/daemon/server/start.js", "/w/lw", true},
		{"node /w/old/node_modules/nx/src/daemon/server/start.js", "/w/old", true},
		{"node /w/lw/node_modules/vite/bin/vite.js", "", false},
		{"node /w/lw/tools/daemon/server/start.js", "", false},
	}
	for _, c := range cases {
		got, ok := NxDaemonWorktree(c.command)
		if got != c.want || ok != c.ok {
			t.Errorf("NxDaemonWorktree(%q) = %q,%v; want %q,%v", c.command, got, ok, c.want, c.ok)
		}
	}
}

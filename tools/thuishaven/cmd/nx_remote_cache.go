package cmd

import (
	"os"
	"os/exec"
	"path/filepath"
)

// nxRemoteCacheSetup is the Nx remote cache check pnpm dev runs too
// (dev/nx/remote-cache/setup.mjs): one line when there is no GitHub login,
// never a prompt.
const nxRemoteCacheSetup = "dev/nx/remote-cache/setup.mjs"

// shouldSetUpNxRemoteCache says whether this up has someone to tell: a
// person at a terminal, or an agent that reads the one line. The detached
// child of up -d has neither.
func shouldSetUpNxRemoteCache(isStub, isAgent, isTTY bool) bool {
	return !isStub && (isAgent || isTTY)
}

// ensureNxRemoteCache runs the check with this terminal's output. It reads no
// input and never fails up: with no node, no script or no login the cache is off.
func ensureNxRemoteCache(worktree string) {
	script := filepath.Join(worktree, filepath.FromSlash(nxRemoteCacheSetup))
	if _, err := os.Stat(script); err != nil {
		return
	}
	cmd := exec.Command("node", script)
	cmd.Dir = worktree
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	_ = cmd.Run()
}

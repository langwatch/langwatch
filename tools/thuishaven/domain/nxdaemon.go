package domain

import "strings"

// nxDaemonEntry is the tail of the script every Nx daemon runs
// (nx/dist/src/daemon/server/start.js). Nx forks it from the checkout's own
// node_modules, so the path in front of node_modules is the worktree it serves.
const nxDaemonEntry = "/daemon/server/start.js"

// NxDaemonWorktree reads the worktree an Nx daemon serves off its command line,
// or ok=false when the command is not an Nx daemon.
func NxDaemonWorktree(command string) (worktree string, ok bool) {
	for _, word := range strings.Fields(command) {
		if !strings.HasSuffix(word, nxDaemonEntry) || !strings.Contains(word, "/nx/") {
			continue
		}
		if dir, _, found := strings.Cut(word, "/node_modules/"); found && dir != "" {
			return dir, true
		}
	}
	return "", false
}

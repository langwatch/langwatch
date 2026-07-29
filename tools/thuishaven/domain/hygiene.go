package domain

// ReclaimablePaths are the regenerable local-dev artefacts `haven prune` reclaims
// from a worktree that is neither running (up) nor dirty (uncommitted changes).
// node_modules dominates a ~60-worktree checkout; the rest are caches, build
// output, and logs that any `pnpm install` / `pnpm dev` recreates. Paths are
// relative to a worktree root.
var ReclaimablePaths = []string{
	"node_modules",
	"langwatch/node_modules",
	"mcp-server/node_modules",
	"typescript-sdk/node_modules",
	"langwatch/dist",
	"langwatch/.vite",
	"langwatch/coverage",
	"langwatch/server.log",
}

package domain

// ReclaimablePaths are the regenerable local-dev artefacts `haven prune` reclaims
// from a worktree that is neither running (up) nor dirty (uncommitted changes).
// node_modules dominates a ~60-worktree checkout; the rest are caches, build
// output, and logs that any `pnpm install` / `pnpm dev` recreates. Paths are
// relative to a worktree root.
var ReclaimablePaths = []string{
	"node_modules",
	"platform/app/node_modules",
	"mcp/typescript/node_modules",
	"sdks/typescript/node_modules",
	"platform/app/dist",
	"platform/app/.vite",
	"platform/app/coverage",
	"platform/app/server.log",
}

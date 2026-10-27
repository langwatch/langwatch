package cmd

import (
	"os"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// guardSeedEnv refuses to run a destructive dev command (seed) when the database
// URLs the seed child will actually connect to point anywhere but the local dev
// servers. It resolves each URL exactly as the seed child does: the registered
// stack's overlay, which haven hands the child explicitly, wins over the process
// environment, which wins over .env — so the environment this guard validates
// and the environment the seed connects to are provably the same. A stray
// production DATABASE_URL, whether pinned in .env or exported in the shell, is
// caught here instead of being seeded into.
func guardSeedEnv(d deps) error {
	return guardSeedEnvIn(stackOverlayOf(d), d.worktree)
}

// stackOverlayOf is this worktree's resolved stack environment, or nil when no
// stack is registered — which is exactly when the seed child would inherit its
// URLs instead of being handed them.
func stackOverlayOf(d deps) []string {
	if d.orch == nil {
		return nil
	}
	env, err := d.orch.StackEnv(d.params)
	if err != nil {
		return nil
	}
	return env
}

// guardSeedEnvIn is the guard with its two inputs named, so the precedence can
// be exercised without an orchestrator or a registry on disk.
func guardSeedEnvIn(overlay []string, repoDir string) error {
	return domain.GuardSeedTargets(overlay, domain.LoadDotenv(repoDir), os.Getenv)
}

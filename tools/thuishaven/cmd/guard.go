package cmd

import (
	"os"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// guardSeedEnv refuses to run a destructive dev command (seed) when the database
// URLs the seed child will actually connect to point anywhere but the local dev
// servers. It resolves each URL exactly as the seed child does — a value exported
// in the process environment wins over the merged dotenv layers (.env then
// .env.portless), which is how Prisma/tsx resolve them — so the environment this
// guard validates and the environment the seed connects to are provably the same.
// A stray production DATABASE_URL, whether pinned in .env or exported in the
// shell, is caught here instead of being seeded into.
func guardSeedEnv(lwDir string) error {
	return domain.GuardSeedTargets(domain.LoadDotenv(lwDir), os.Getenv)
}

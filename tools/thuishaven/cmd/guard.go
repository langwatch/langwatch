package cmd

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// guardSeedEnv refuses to run a destructive dev command (seed) when the
// worktree's effective database URLs point anywhere but the local dev servers.
// The seed process inherits langwatch/.env with langwatch/.env.portless layered
// over it (same precedence as the app), so a stray production DATABASE_URL in
// someone's .env is caught here instead of being seeded into.
func guardSeedEnv(lwDir string) error {
	env := map[string]string{}
	for _, name := range []string{".env", ".env.portless"} {
		readEnvFile(filepath.Join(lwDir, name), env)
	}
	if err := domain.GuardLocalDatabaseURL(env["DATABASE_URL"], domain.PostgresRole); err != nil {
		return fmt.Errorf("refusing to seed: %w", err)
	}
	if err := domain.GuardLocalDatabaseURL(env["CLICKHOUSE_URL"], ""); err != nil {
		return fmt.Errorf("refusing to seed: %w", err)
	}
	return nil
}

// readEnvFile merges KEY=VALUE lines from a dotenv file into env (later files
// override earlier ones, matching the app's own load order). Missing files are
// fine; this is a guard, not a loader.
func readEnvFile(path string, env map[string]string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		env[strings.TrimSpace(key)] = value
	}
}

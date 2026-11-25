package cmd

import (
	"os"
	"path/filepath"
	"testing"
)

func writeEnvFixture(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

// clearSeedEnv drops any DATABASE_URL/CLICKHOUSE_URL the test runner's own shell
// exported, so a subtest that means to exercise dotenv resolution is not silently
// overridden by the ambient process environment (which guardSeedEnv, correctly,
// prefers).
func clearSeedEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "")
	t.Setenv("CLICKHOUSE_URL", "")
}

// @scenario "Destructive commands refuse anything that is not local dev"
func TestGuardSeedEnv(t *testing.T) {
	t.Run("given a production-looking DATABASE_URL in .env", func(t *testing.T) {
		t.Run("when guarding, it refuses before seeding", func(t *testing.T) {
			clearSeedEnv(t)
			dir := t.TempDir()
			writeEnvFixture(t, dir, ".env", "DATABASE_URL=postgresql://prisma:prisma@db.prod.example.com:5432/langwatch\n")
			if err := guardSeedEnvIn(nil, dir); err == nil {
				t.Fatal("expected a refusal for a non-local DATABASE_URL")
			}
		})
	})

	t.Run("given the running stack's overlay overriding a stray .env DATABASE_URL", func(t *testing.T) {
		t.Run("when guarding, the local override passes", func(t *testing.T) {
			clearSeedEnv(t)
			dir := t.TempDir()
			writeEnvFixture(t, dir, ".env", "DATABASE_URL=postgresql://prisma:prisma@db.prod.example.com:5432/langwatch\n")
			overlay := []string{"DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5432/lw_feat_x"}
			if err := guardSeedEnvIn(overlay, dir); err != nil {
				t.Fatalf("the injected local URL is what the seed connects to, got %v", err)
			}
		})
	})

	t.Run("given the running stack's overlay and a stray production export", func(t *testing.T) {
		t.Run("when guarding, the overlay wins because the child is handed it", func(t *testing.T) {
			dir := t.TempDir()
			t.Setenv("CLICKHOUSE_URL", "")
			t.Setenv("DATABASE_URL", "postgresql://prisma:prisma@db.prod.example.com:5432/langwatch")
			overlay := []string{"DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5432/lw_feat_x"}
			if err := guardSeedEnvIn(overlay, dir); err != nil {
				t.Fatalf("haven passes the overlay to the child explicitly, so it wins, got %v", err)
			}
		})
	})

	t.Run("given quoted and export-prefixed local URLs", func(t *testing.T) {
		t.Run("when guarding, they parse and pass", func(t *testing.T) {
			clearSeedEnv(t)
			dir := t.TempDir()
			writeEnvFixture(t, dir, ".env",
				"export DATABASE_URL=\"postgresql://prisma:prisma@localhost:5432/lw_x\"\n"+
					"CLICKHOUSE_URL='http://default:pass@127.0.0.1:8123/lw_x'\n")
			if err := guardSeedEnvIn(nil, dir); err != nil {
				t.Fatalf("quoted/export local URLs should pass, got %v", err)
			}
		})
	})

	t.Run("given an inline comment after a local DATABASE_URL", func(t *testing.T) {
		t.Run("when guarding, the comment is stripped and the local URL passes", func(t *testing.T) {
			clearSeedEnv(t)
			dir := t.TempDir()
			writeEnvFixture(t, dir, ".env", "DATABASE_URL=postgresql://prisma:prisma@localhost:5432/lw_x # local dev\n")
			if err := guardSeedEnvIn(nil, dir); err != nil {
				t.Fatalf("inline comment should be stripped, got %v", err)
			}
		})
	})

	t.Run("given a non-local CLICKHOUSE_URL alongside a local DATABASE_URL", func(t *testing.T) {
		t.Run("when guarding, it refuses on the ClickHouse URL", func(t *testing.T) {
			clearSeedEnv(t)
			dir := t.TempDir()
			writeEnvFixture(t, dir, ".env",
				"DATABASE_URL=postgresql://prisma:prisma@localhost:5432/lw_x\n"+
					"CLICKHOUSE_URL=https://ch.eu-cluster.example.com/traces\n")
			if err := guardSeedEnvIn(nil, dir); err == nil {
				t.Fatal("expected a refusal for a non-local CLICKHOUSE_URL")
			}
		})
	})

	t.Run("given a stray production DATABASE_URL exported in the process environment", func(t *testing.T) {
		t.Run("when guarding, the exported value wins over a local .env and is refused", func(t *testing.T) {
			dir := t.TempDir()
			// .env is local, but a process-env export — which the seed child inherits
			// and Prisma prefers — points at production. The guard must validate the
			// URL the seed will actually connect to, not the masked dotenv value.
			writeEnvFixture(t, dir, ".env", "DATABASE_URL=postgresql://prisma:prisma@localhost:5432/lw_x\n")
			t.Setenv("CLICKHOUSE_URL", "")
			t.Setenv("DATABASE_URL", "postgresql://prisma:prisma@db.prod.example.com:5432/langwatch")
			if err := guardSeedEnvIn(nil, dir); err == nil {
				t.Fatal("expected the exported production DATABASE_URL to be refused")
			}
		})
	})
}

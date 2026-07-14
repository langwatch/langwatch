package domain

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGuardLocalDatabaseURL(t *testing.T) {
	t.Run("given a loopback dev URL", func(t *testing.T) {
		t.Run("when guarded, it passes", func(t *testing.T) {
			for _, u := range []string{
				"postgresql://prisma:prisma@localhost:5432/lw_portless",
				"postgresql://prisma:prisma@127.0.0.1:5432/lw_portless",
				"http://default:pass@127.0.0.1:8123/lw_portless",
				"https://clickhouse.portless.langwatch.localhost/lw_portless",
				"",
			} {
				if err := GuardLocalDatabaseURL(u, ""); err != nil {
					t.Errorf("GuardLocalDatabaseURL(%q) = %v, want nil", u, err)
				}
			}
		})
	})

	t.Run("given a non-local host", func(t *testing.T) {
		t.Run("when guarded, it refuses", func(t *testing.T) {
			for _, u := range []string{
				"postgresql://prisma:prisma@db.internal.example.com:5432/lw_x",
				"postgresql://user:pass@10.1.2.3:5432/langwatch",
				"https://ch.eu-cluster.example.com/traces",
			} {
				if err := GuardLocalDatabaseURL(u, ""); err == nil {
					t.Errorf("GuardLocalDatabaseURL(%q) = nil, want refusal", u)
				}
			}
		})
	})

	t.Run("given the wrong database user", func(t *testing.T) {
		t.Run("when guarded, it refuses and names the expected user", func(t *testing.T) {
			err := GuardLocalDatabaseURL("postgresql://admin:pw@localhost:5432/lw_x", "prisma")
			if err == nil || !strings.Contains(err.Error(), "prisma") {
				t.Errorf("expected wrong-user refusal naming prisma, got %v", err)
			}
		})
		t.Run("when the user matches, it passes", func(t *testing.T) {
			if err := GuardLocalDatabaseURL("postgresql://prisma:pw@localhost:5432/lw_x", "prisma"); err != nil {
				t.Errorf("expected match to pass, got %v", err)
			}
		})
	})

	t.Run("given a URL that smells like production", func(t *testing.T) {
		t.Run("when guarded, it refuses", func(t *testing.T) {
			for _, u := range []string{
				"postgresql://prisma:prisma@localhost:5432/langwatch_prod",
				"postgresql://prisma:prisma@localhost:5432/app_staging",
			} {
				if err := GuardLocalDatabaseURL(u, ""); err == nil {
					t.Errorf("GuardLocalDatabaseURL(%q) = nil, want refusal", u)
				}
			}
		})
	})

	t.Run("given credentials embedded in an unparseable URL", func(t *testing.T) {
		t.Run("when guarded, the error never echoes them", func(t *testing.T) {
			err := GuardLocalDatabaseURL("postgresql://secret:hunter2@bad host/db", "")
			if err == nil {
				t.Fatal("expected refusal")
			}
			if strings.Contains(err.Error(), "hunter2") {
				t.Errorf("error leaked credentials: %v", err)
			}
		})
	})
}

func TestIsProtectedDatabase(t *testing.T) {
	if !IsProtectedDatabase("lw_main") {
		t.Error("lw_main must be protected from bulk cleanup")
	}
	if IsProtectedDatabase("lw_portless") {
		t.Error("per-worktree databases are not protected")
	}
}

func TestGuardSeedTargets(t *testing.T) {
	local := map[string]string{
		"DATABASE_URL":   "postgresql://prisma:prisma@127.0.0.1:5432/lw_x",
		"CLICKHOUSE_URL": "http://default:pass@127.0.0.1:8123/lw_x",
	}
	none := func(string) string { return "" }

	t.Run("given only local dotenv values and no process overrides", func(t *testing.T) {
		t.Run("when guarded, it passes", func(t *testing.T) {
			if err := GuardSeedTargets(local, none); err != nil {
				t.Fatalf("local targets should pass, got %v", err)
			}
		})
	})

	t.Run("given a process-env DATABASE_URL masking a local dotenv value", func(t *testing.T) {
		t.Run("when guarded, the process value wins and a production URL is refused", func(t *testing.T) {
			getenv := func(k string) string {
				if k == "DATABASE_URL" {
					return "postgresql://prisma:prisma@db.prod.example.com:5432/langwatch"
				}
				return ""
			}
			if err := GuardSeedTargets(local, getenv); err == nil {
				t.Fatal("expected the process-env production URL to be refused")
			}
		})
	})

	t.Run("given a stray production DATABASE_URL in dotenv with no process override", func(t *testing.T) {
		t.Run("when guarded, it refuses", func(t *testing.T) {
			env := map[string]string{"DATABASE_URL": "postgresql://prisma:prisma@10.1.2.3:5432/langwatch"}
			if err := GuardSeedTargets(env, none); err == nil {
				t.Fatal("expected a non-local dotenv URL to be refused")
			}
		})
	})
}

func TestReadEnvFile(t *testing.T) {
	write := func(t *testing.T, body string) string {
		t.Helper()
		path := filepath.Join(t.TempDir(), ".env")
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatalf("write env: %v", err)
		}
		return path
	}

	t.Run("given an unquoted value with a trailing inline comment", func(t *testing.T) {
		t.Run("when read, the comment is stripped from the value", func(t *testing.T) {
			env := map[string]string{}
			ReadEnvFile(write(t, "DATABASE_URL=postgres://localhost/db # note\n"), env)
			if got := env["DATABASE_URL"]; got != "postgres://localhost/db" {
				t.Errorf("value = %q, want the comment stripped", got)
			}
		})
	})

	t.Run("given a quoted value that itself contains a hash", func(t *testing.T) {
		t.Run("when read, everything inside the quotes is kept", func(t *testing.T) {
			env := map[string]string{}
			ReadEnvFile(write(t, "TOKEN=\"a#b c\"\n"), env)
			if got := env["TOKEN"]; got != "a#b c" {
				t.Errorf("value = %q, want the quoted content kept", got)
			}
		})
	})

	t.Run("given an export-prefixed line", func(t *testing.T) {
		t.Run("when read, the export prefix is dropped", func(t *testing.T) {
			env := map[string]string{}
			ReadEnvFile(write(t, "export FOO=bar\n"), env)
			if got := env["FOO"]; got != "bar" {
				t.Errorf("value = %q, want bar", got)
			}
		})
	})
}

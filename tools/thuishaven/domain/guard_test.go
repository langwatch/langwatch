package domain

import (
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

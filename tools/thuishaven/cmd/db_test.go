package cmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// `haven db reset` in a feature worktree drops that worktree's own data. Run
// from the primary checkout on main it drops lw_main — what every worktree that
// never asked for its own data falls back to. Same command, same keystroke,
// very different blast radius, so the ceremony has to tell them apart.
//
// @scenario "Resetting the shared database asks for more than a keystroke"
func TestConfirmDBResetGuardsTheSharedDatabaseHarder(t *testing.T) {
	t.Run("given the shared main database", func(t *testing.T) {
		t.Run("when a human answers y", func(t *testing.T) {
			out := &bytes.Buffer{}
			proceed, err := confirmDBReset(dbResetConfirm{
				db: domain.MainDatabase, in: strings.NewReader("y\n"), out: out,
			})
			if err != nil {
				t.Fatalf("confirmDBReset: %v", err)
			}
			if proceed {
				t.Error("a bare y dropped the database every other worktree falls back to")
			}
			if !strings.Contains(out.String(), "shared") {
				t.Errorf("prompt %q never says the database is shared", out)
			}
		})

		t.Run("when a human types the database name", func(t *testing.T) {
			out := &bytes.Buffer{}
			proceed, err := confirmDBReset(dbResetConfirm{
				db: domain.MainDatabase, in: strings.NewReader(domain.MainDatabase + "\n"), out: out,
			})
			if err != nil {
				t.Fatalf("confirmDBReset: %v", err)
			}
			if !proceed {
				t.Error("typing the exact database name must be a way through; otherwise the reset is unreachable")
			}
		})

		t.Run("when nothing is answered at all", func(t *testing.T) {
			proceed, err := confirmDBReset(dbResetConfirm{
				db: domain.MainDatabase, in: strings.NewReader(""), out: &bytes.Buffer{},
			})
			if err != nil {
				t.Fatalf("confirmDBReset: %v", err)
			}
			if proceed {
				t.Error("a closed stdin was read as consent")
			}
		})

		t.Run("when an agent runs it without --yes", func(t *testing.T) {
			_, err := confirmDBReset(dbResetConfirm{
				db: domain.MainDatabase, isAgent: true, in: strings.NewReader(""), out: &bytes.Buffer{},
			})
			if err == nil {
				t.Fatal("agent mode dropped the shared database with no confirmation")
			}
			// The refusal is the only place an agent's operator learns what this
			// database is before being told which flag overrides it.
			if !strings.Contains(err.Error(), "shared") {
				t.Errorf("refusal %q does not say the database is shared", err)
			}
			if !strings.Contains(err.Error(), "--yes") {
				t.Errorf("refusal %q does not name the flag that confirms", err)
			}
		})

		// --yes stays sufficient — scripts depend on it (ADR-064) — but it stops
		// being silent about which database it just took.
		t.Run("when --yes is passed", func(t *testing.T) {
			out := &bytes.Buffer{}
			proceed, err := confirmDBReset(dbResetConfirm{
				db: domain.MainDatabase, yes: true, in: strings.NewReader(""), out: out,
			})
			if err != nil {
				t.Fatalf("confirmDBReset: %v", err)
			}
			if !proceed {
				t.Error("--yes must still confirm; scripts have no prompt to answer")
			}
			if !strings.Contains(out.String(), domain.MainDatabase) || !strings.Contains(out.String(), "shared") {
				t.Errorf("output %q does not say which database is going, or that it is shared", out)
			}
		})
	})

	t.Run("given a worktree's own database", func(t *testing.T) {
		const db = "lw_feat_x"

		t.Run("when a human answers y", func(t *testing.T) {
			out := &bytes.Buffer{}
			proceed, err := confirmDBReset(dbResetConfirm{db: db, in: strings.NewReader("y\n"), out: out})
			if err != nil {
				t.Fatalf("confirmDBReset: %v", err)
			}
			if !proceed {
				t.Error("a worktree's own database must still take a plain yes — the harder ceremony is for the shared one")
			}
			if strings.Contains(out.String(), "shared") {
				t.Errorf("prompt %q calls a worktree's own database shared", out)
			}
		})

		t.Run("when a human answers anything else", func(t *testing.T) {
			out := &bytes.Buffer{}
			proceed, _ := confirmDBReset(dbResetConfirm{db: db, in: strings.NewReader("n\n"), out: out})
			if proceed {
				t.Error("n was read as consent")
			}
			if !strings.Contains(out.String(), "nothing was dropped") {
				t.Errorf("output %q does not say the abort dropped nothing", out)
			}
		})

		t.Run("when an agent runs it without --yes", func(t *testing.T) {
			_, err := confirmDBReset(dbResetConfirm{
				db: db, isAgent: true, in: strings.NewReader(""), out: &bytes.Buffer{},
			})
			if err == nil {
				t.Fatal("agent mode reset a database with no confirmation")
			}
			if !strings.Contains(err.Error(), db) {
				t.Errorf("refusal %q does not name the database", err)
			}
		})
	})
}

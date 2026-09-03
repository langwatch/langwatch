package cmd

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// runDB is `haven db <reset|url>` — the one noun for this stack's data.
// reset is the only way haven drops data on purpose: it states what it will
// drop and asks, `--yes` replaces the prompt for scripts, and agent mode
// never destroys without it.
func runDB(ctx context.Context, d deps, inv invocation) error {
	usage := "usage: haven db reset [preset] [--yes] | haven db seed [preset] | haven db url [postgres|clickhouse|redis]\n  presets: " + strings.Join(app.SeedPresetNames(), ", ")
	if len(inv.args) == 0 {
		return errors.New(usage)
	}
	switch inv.args[0] {
	case "reset":
		if err := guardSeedEnv(d.worktree); err != nil {
			return err
		}
		slug, err := d.orch.ResolveSlug(d.params)
		if err != nil {
			return err
		}
		proceed, err := confirmDBReset(dbResetConfirm{
			db:      domain.DatabaseForSlug(slug),
			isAgent: d.isAgent,
			yes:     inv.has("--yes"),
			in:      os.Stdin,
			out:     os.Stdout,
		})
		if err != nil || !proceed {
			return err
		}
		return d.orch.DBReset(ctx, d.params, dbPresetArg(inv))
	case "seed":
		if inv.has("--yes") {
			return fmt.Errorf("db seed is non-destructive (an idempotent upsert, nothing dropped) — no confirmation to give")
		}
		if err := guardSeedEnv(d.worktree); err != nil {
			return err
		}
		return d.orch.DBSeed(ctx, d.params, dbPresetArg(inv))
	case "url":
		if inv.has("--yes") {
			return fmt.Errorf("--yes does not apply to `haven db url`")
		}
		engine := ""
		if len(inv.args) > 1 {
			engine = inv.args[1]
		}
		return d.orch.DBURL(ctx, d.params, engine)
	default:
		return fmt.Errorf("unknown `haven db` subcommand %q — %s", inv.args[0], usage)
	}
}

// dbResetConfirm is what the reset ceremony needs to decide: which database is
// about to go, whether a human is there to answer, and where to ask.
type dbResetConfirm struct {
	db      string
	isAgent bool
	yes     bool
	in      io.Reader
	out     io.Writer
}

// confirmDBReset runs the confirmation ceremony for `haven db reset`, reporting
// whether the reset should go ahead.
//
// The shared main database gets a louder one than a worktree's own. Every
// worktree that never asked for its own data falls back to it, so dropping it —
// which is what `haven db reset` in the primary checkout on main does — takes
// data the developer is unlikely to think of as "this stack's". A y/N prompt is
// the same keystroke either way; typing the database name is not, and that is
// the whole point of the distinction. `--yes` still stands for scripts, but it
// says out loud what it is about to take.
func confirmDBReset(c dbResetConfirm) (bool, error) {
	shared := domain.IsProtectedDatabase(c.db)
	switch {
	case c.yes:
		if shared {
			fmt.Fprintf(c.out, "dropping %q — the shared database every worktree without its own falls back to\n", c.db)
		}
		return true, nil
	case c.isAgent && shared:
		return false, fmt.Errorf(
			"db reset would drop %q, the shared database every worktree without its own falls back to, not just this stack's — pass --yes to confirm",
			c.db)
	case c.isAgent:
		return false, fmt.Errorf(
			"db reset drops and recreates database %q on the managed ClickHouse and Postgres — pass --yes to confirm", c.db)
	}

	answer := askDBReset(c, shared)
	if shared {
		// Nothing but the exact name: "y" must not be able to drop the database
		// every other worktree shares.
		if answer != c.db {
			fmt.Fprintln(c.out, "aborted — nothing was dropped")
			return false, nil
		}
		return true, nil
	}
	switch strings.ToLower(answer) {
	case "y", "yes":
		return true, nil
	}
	fmt.Fprintln(c.out, "aborted — nothing was dropped")
	return false, nil
}

// askDBReset prints the prompt the target deserves and reads one answer. A
// read that yields nothing answers nothing, which the caller treats as no.
func askDBReset(c dbResetConfirm, shared bool) string {
	if shared {
		fmt.Fprintf(c.out,
			"This drops and recreates %q — the shared database every worktree without its own\nfalls back to, not just this stack's. Type the database name to continue: ", c.db)
	} else {
		fmt.Fprintf(c.out,
			"This drops and recreates database %q on the managed ClickHouse and Postgres,\nthen migrates and seeds it fresh. Continue? [y/N] ", c.db)
	}
	// io.EOF with content is a final line without a trailing newline — a real
	// answer. Only a read that produced nothing answered nothing.
	answer, _ := bufio.NewReader(c.in).ReadString('\n')
	return strings.TrimSpace(answer)
}

// dbPresetArg is the optional positional preset after reset/seed.
func dbPresetArg(inv invocation) string {
	if len(inv.args) > 1 {
		return inv.args[1]
	}
	return ""
}

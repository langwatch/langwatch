package cmd

import (
	"bufio"
	"context"
	"fmt"
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
	const usage = "usage: haven db reset [--demo] [--yes] | haven db url [postgres|clickhouse|redis]"
	if len(inv.args) == 0 {
		return fmt.Errorf(usage)
	}
	switch inv.args[0] {
	case "reset":
		if len(inv.args) > 1 {
			return fmt.Errorf(usage)
		}
		if err := guardSeedEnv(d.lwDir); err != nil {
			return err
		}
		slug, err := d.orch.ResolveSlug(d.params)
		if err != nil {
			return err
		}
		db := domain.DatabaseForSlug(slug)
		if !inv.has("--yes") {
			if d.isAgent {
				return fmt.Errorf("db reset drops and recreates database %q on the managed ClickHouse and Postgres — pass --yes to confirm", db)
			}
			fmt.Printf("This drops and recreates database %q on the managed ClickHouse and Postgres,\nthen migrates and seeds it fresh. Continue? [y/N] ", db)
			answer, _ := bufio.NewReader(os.Stdin).ReadString('\n')
			switch strings.ToLower(strings.TrimSpace(answer)) {
			case "y", "yes":
			default:
				fmt.Println("aborted — nothing was dropped")
				return nil
			}
		}
		return d.orch.DBReset(ctx, d.params, app.DBResetOptions{Demo: inv.has("--demo")})
	case "url":
		if inv.has("--demo") || inv.has("--yes") {
			return fmt.Errorf("--demo/--yes only apply to `haven db reset`")
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

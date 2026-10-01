package cmd

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// `haven destroy <slug>` is `haven down` plus the data. It exists because
// "stop this stack and take its databases with it" was reachable only through
// the hub's interactive worktree picker, which addresses a DIRECTORY - the
// wrong noun for a throwaway stack booted inside a checkout somebody else
// owns. apidiff boots one stack per instance under its own run-scoped slug in
// the developer's own worktree; naming the slug is what lets its teardown take
// exactly what it started and nothing else.
//
// It is destructive, so it follows the same ceremony as `haven db reset`: a
// y/N prompt for a person, `--yes` for a script, and an agent gets no prompt
// at all - only the explicit flag.

// runDestroy is `haven destroy <slug> [--yes]`.
func runDestroy(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New("usage: haven destroy <slug> [--yes] - the slug names the stack, `haven status` lists them")
	}
	slug := inv.args[0]
	if !domain.ValidSlug(slug) {
		return domain.ErrInvalidSlug(slug)
	}
	proceed, err := confirmDestroy(destroyConfirm{
		slug:    slug,
		db:      domain.DatabaseForSlug(slug),
		isAgent: d.isAgent,
		yes:     inv.has("--yes"),
		in:      os.Stdin,
		out:     os.Stdout,
	})
	if err != nil || !proceed {
		return err
	}
	return d.orch.DestroyStack(ctx, slug)
}

// destroyConfirm is what the ceremony needs to decide: which stack and which
// database are about to go, whether a person is there to answer, and where to
// ask.
type destroyConfirm struct {
	slug    string
	db      string
	isAgent bool
	yes     bool
	in      io.Reader
	out     io.Writer
}

// confirmDestroy runs the confirmation ceremony, reporting whether the destroy
// should go ahead. The shared main database is refused here as well as in the
// orchestrator: the answer a person is asked for should never be one that
// cannot be honored.
func confirmDestroy(c destroyConfirm) (bool, error) {
	if domain.IsProtectedDatabase(c.db) {
		return false, fmt.Errorf("refusing to destroy %q - %s is the shared database every worktree without its own falls back to", c.slug, c.db)
	}
	switch {
	case c.yes:
		return true, nil
	case c.isAgent:
		return false, fmt.Errorf(
			"destroy stops stack %q and drops its database %s on the managed ClickHouse and Postgres - pass --yes to confirm", c.slug, c.db)
	}
	fmt.Fprintf(c.out,
		"This stops stack %q and drops its database %q on the managed ClickHouse and\nPostgres. The worktree is left alone. Continue? [y/N] ", c.slug, c.db)
	answer, _ := bufio.NewReader(c.in).ReadString('\n')
	switch strings.ToLower(strings.TrimSpace(answer)) {
	case "y", "yes":
		return true, nil
	}
	fmt.Fprintln(c.out, "aborted - nothing was stopped or dropped")
	return false, nil
}

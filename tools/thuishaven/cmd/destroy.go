package cmd

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// `haven down --destroy` is `haven down` plus the data. Naming the stack with
// --stack is what lets apidiff's teardown take exactly the run-scoped stack it
// booted inside somebody else's worktree, and nothing else.
//
// It is destructive, so a person types the slug (a plain y does not count), a
// script passes --yes, and an agent gets no prompt at all: only the flag.

// runDownDestroy is `haven down --destroy [--stack <slug>] [--yes]`.
func runDownDestroy(ctx context.Context, d deps, inv invocation) error {
	slug, err := d.orch.ResolveSlug(d.params)
	if err != nil {
		return err
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
	stopBrowser(slug)
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
		return false, usageErr(
			"down --destroy stops stack %q and drops its database %s on the managed ClickHouse and Postgres - pass --yes to confirm", c.slug, c.db)
	}
	fmt.Fprintf(c.out,
		"This stops stack %q and drops its database %q on the managed ClickHouse and\nPostgres. The worktree is left alone. Type the stack's slug to continue: ", c.slug, c.db)
	answer, _ := bufio.NewReader(c.in).ReadString('\n')
	if strings.TrimSpace(answer) == c.slug {
		return true, nil
	}
	fmt.Fprintln(c.out, "aborted - nothing was stopped or dropped")
	return false, nil
}

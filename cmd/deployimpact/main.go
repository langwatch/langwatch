// Command deployimpact writes a pull request's deployment impact, read from its
// diff. It exits 2 when a fact breaks an existing install and the pull request
// does not carry the operator-action label, and 1 when it could not read the diff.
//
// Usage (in a clone holding both revisions):
//
//	go run ./cmd/deployimpact -base <sha> -head <sha> [-acknowledged] [-out report.md]
//
// Spec: specs/ci/deployment-impact-report.feature
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/langwatch/langwatch/tools/deployimpact"
)

// no-test: flag parsing and file writing; tools/deployimpact tests the report.
func main() {
	base := flag.String("base", "", "the base branch's revision")
	head := flag.String("head", "HEAD", "the pull request's revision")
	acknowledged := flag.Bool("acknowledged", false, "the pull request carries the "+deployimpact.Label+" label")
	out := flag.String("out", "", "also write the report to this file")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	blocked, err := run(ctx, options{base: *base, head: *head, acknowledged: *acknowledged, out: *out})
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "::error::Could not compute the deployment impact: %v\n", err)
		os.Exit(1)
	}
	if blocked {
		fmt.Fprintf(os.Stderr, "::error::This pull request breaks an existing install; see the deployment impact report. Change the code, or have a maintainer add the %s label.\n", deployimpact.Label)
		os.Exit(2)
	}
}

type options struct {
	base, head, out string
	acknowledged    bool
}

func run(ctx context.Context, opts options) (bool, error) {
	base, head := opts.base, opts.head
	if base == "" {
		return false, fmt.Errorf("-base is required")
	}
	forkPoint, err := deployimpact.MergeBase(ctx, base, head)
	if err != nil {
		return false, err
	}
	changes, err := deployimpact.Changes(ctx, forkPoint, head)
	if err != nil {
		return false, err
	}
	report, err := deployimpact.Compute(deployimpact.GitTree{Ctx: ctx, Rev: forkPoint}, deployimpact.GitTree{Ctx: ctx, Rev: head}, changes)
	if err != nil {
		return false, err
	}
	text := deployimpact.Render(report, opts.acknowledged)
	fmt.Print(text)
	if opts.out != "" {
		if err := os.WriteFile(opts.out, []byte(text), 0o600); err != nil {
			return false, err
		}
	}
	return report.Blocked() && !opts.acknowledged, nil
}

// Command seedgen plans and runs a seed without haven, for CI and scripts (design §1, §9.2).
package main

import (
	"fmt"
	"io"
	"os"
	"time"

	"github.com/langwatch/langwatch/tools/seedgen"
)

const usage = "usage: seedgen plan|run [--size tiny|small|medium|large] [--spans N] [--days D] " +
	"[--persona startup,enterprise,gateway,agent-eval|all] [--private N] [--seed S] [--anchor RFC3339] " +
	"[--shape saas|sh-licensed|sh-free] [--dry-run]\n       seedgen coverage --static [--manifest FILE] [--json]"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run exits 0 done, 1 a check failed, 2 refused before writing (design §9.2).
func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		_, _ = fmt.Fprintln(stderr, usage)
		return 2
	}
	switch args[0] {
	case "coverage":
		return seedgen.RunCoverage(args[1:], stdout, stderr)
	case "plan", "run":
	default:
		_, _ = fmt.Fprintf(stderr, "seedgen: unknown command %q\n%s\n", args[0], usage)
		return 2
	}
	flags, err := seedgen.ParseFlags(args[1:], time.Now().UTC().Truncate(time.Hour))
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "seedgen %s: %v\n", args[0], err)
		return 2
	}
	plan, err := seedgen.NewPlan(flags)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "seedgen %s: %v\n", args[0], err)
		return 2
	}
	if args[0] == "run" && !flags.DryRun {
		_, _ = fmt.Fprintln(stderr, "seedgen run: the executors are not built yet (SG5); use --dry-run")
		return 2
	}
	_, _ = fmt.Fprintf(stdout, "run %s, recipe %s, anchor %s, seed %d\n", plan.Run, seedgen.Recipe,
		flags.Anchor.Format(time.RFC3339), flags.Seed)
	plan.Estimate().Print(stdout)
	return 0
}

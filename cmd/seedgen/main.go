// Command seedgen plans and runs a seed without haven, for CI and scripts (design §1, §9.2).
package main

import (
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/seedgen"
)

const usage = "usage: seedgen plan|run [--size tiny|small|medium|large] [--spans N] [--days D] " +
	"[--persona startup,enterprise,gateway,agent-eval|all] [--private N] [--seed S] [--anchor RFC3339] " +
	"[--shape saas|sh-licensed|sh-free] [--org name=..,plan=free,users=N,persona=..]... [--into ORG_ID/PROJECT_ID] " +
	"[--admin EMAIL (default LANGWATCH_ADMIN_EMAIL)] [--dry-run]\n" +
	"       run only: [--executor task|door] [--app URL] [--run-dir DIR] [--resume]\n       seedgen coverage --static [--manifest FILE] [--json]"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run exits 0 done, 1 a check failed, 2 refused before writing, 4 stalled (design §5.4, §9.2).
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
	options, rest, err := parseRunOptions(args[1:])
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "seedgen %s: %v\n", args[0], err)
		return 2
	}
	if admin := os.Getenv("LANGWATCH_ADMIN_EMAIL"); admin != "" && !slices.ContainsFunc(rest, isAdminFlag) {
		rest = append(rest, "--admin", admin)
	}
	flags, err := seedgen.ParseFlags(rest, time.Now().UTC().Truncate(time.Hour))
	if err == nil && options.resume {
		flags, err = resumedFlags(options.runDir)
	}
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
		if flags.Admin == "" && flags.Into == "" {
			_, _ = fmt.Fprintln(stderr, "seedgen run: the seeded admin joins every org: set LANGWATCH_ADMIN_EMAIL or pass --admin")
			return 2
		}
		return runSeed(options, plan, streams{stdout, stderr})
	}
	_, _ = fmt.Fprintf(stdout, "run %s, recipe %s, anchor %s, seed %d\n", plan.Run, seedgen.Recipe,
		flags.Anchor.Format(time.RFC3339), flags.Seed)
	plan.Estimate().Print(stdout)
	return 0
}

func isAdminFlag(arg string) bool { return arg == "--admin" || strings.HasPrefix(arg, "--admin=") }

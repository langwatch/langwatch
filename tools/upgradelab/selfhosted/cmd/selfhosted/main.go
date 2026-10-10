// Command selfhosted runs one self-hosted upgrade by the operator's path (package selfhosted).
// Exit 0 every row passed or is inconclusive, 1 a row failed, 2 a step stopped the run or bad usage.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"syscall"

	"github.com/langwatch/langwatch/tools/upgradelab/cell"
	"github.com/langwatch/langwatch/tools/upgradelab/selfhosted"
)

func main() { os.Exit(run()) }

func run() int {
	var options selfhosted.Options
	flags := flag.NewFlagSet("selfhosted", flag.ContinueOnError)
	flags.StringVar(&options.Path, "path", "compose", "compose | helm")
	flags.StringVar(&options.Deployment, "deployment", "self-hosted", "self-hosted (licensed) | self-hosted-free")
	flags.StringVar(&options.MainTree, "main-tree", ".worktrees/upgradelab-main", "a checkout at origin/main")
	flags.StringVar(&options.HeadTree, "head-tree", ".", "the branch checkout")
	flags.StringVar(&options.UIDir, "ui-dir", ".", "a checkout whose apps/ui resolves @playwright/test")
	flags.StringVar(&options.Snapshot, "from-snapshot", "", "a produce entry dir or cache key")
	flags.StringVar(&options.RunDir, "run-dir", "", "where the transcript, report and shots go")
	flags.StringVar(&options.Upgradelab, "upgradelab", ".bin/upgradelab/upgradelab", "the built upgradelab binary")
	flags.Int64Var(&options.Seed, "seed", 1, "the seed the snapshot was produced with")
	flags.BoolVar(&options.NoAdminEmails, "no-admin-emails", false, "boot without ADMIN_EMAILS (sh-free's second variant)")
	flags.BoolVar(&options.DryRun, "dry-run", false, "write the files and transcript.md with every planned command, run nothing")
	if err := flags.Parse(os.Args[1:]); err != nil || options.Snapshot == "" || options.RunDir == "" {
		fmt.Fprintln(os.Stderr, "selfhosted: -from-snapshot and -run-dir are required")
		return 2
	}
	options.Snapshot = cell.ResolveSnapshot(options.Snapshot)
	for _, path := range []*string{&options.MainTree, &options.HeadTree, &options.UIDir, &options.RunDir, &options.Upgradelab} {
		*path, _ = filepath.Abs(*path)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	report, err := selfhosted.Run(ctx, options)
	switch {
	case err != nil:
		fmt.Fprintln(os.Stderr, "selfhosted:", err)
		return 2
	case report.Error != "":
		fmt.Fprintln(os.Stderr, "selfhosted: stopped:", report.Error)
		return 2
	case slices.ContainsFunc(report.Verdicts, func(verdict cell.Verdict) bool { return verdict.Result == "fail" }):
		return 1
	}
	return 0
}

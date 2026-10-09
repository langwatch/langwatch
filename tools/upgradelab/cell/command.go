package cell

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Command parses `upgradelab cell` flags, runs one cell and prints its report; cli.go dispatches to it.
func Command(ctx context.Context, args []string, stdout io.Writer) (int, error) {
	options, err := parse(args)
	if err != nil {
		return 2, err
	}
	if options.PostgresBase == "" || options.ClickHouseBase == "" {
		if options.PostgresBase, options.ClickHouseBase, err = HavenServers(ctx); err != nil {
			return 2, err
		}
	}
	report, err := Run(ctx, options)
	if err != nil || report == nil {
		return 2, err
	}
	fmt.Fprint(stdout, report.Markdown())
	fmt.Fprintf(stdout, "\nreport: %s\n", filepath.Join(options.RunDir, "report.md"))
	return report.ExitCode(), nil
}

// ExitCode is 2 when a step stopped the cell, 1 when an invariant did not pass, else 0.
func (report *Report) ExitCode() int {
	if report.Error != "" {
		return 2
	}
	for _, each := range report.Verdicts {
		if each.Result != "pass" {
			return 1
		}
	}
	return 0
}

func parse(args []string) (Options, error) {
	var options Options
	flags := flag.NewFlagSet("cell", flag.ContinueOnError)
	flags.StringVar(&options.Deployment, "deployment", "cloud", "cloud | hybrid | self-hosted")
	flags.StringVar(&options.Tier, "tier", "S", "volume tier: S (L and XL wait for lane L4)")
	flags.StringVar(&options.Shape, "shape", "typical", "data shape: typical")
	flags.Int64Var(&options.Seed, "seed", 1, "seed for every generated id and payload")
	flags.StringVar(&options.FromDir, "from-dir", ".worktrees/upgradelab-main", "checkout of the release upgraded from (no .env)")
	flags.StringVar(&options.HeadDir, "head-dir", ".worktrees/upgradelab-head", "checkout of the release upgraded to (no .env)")
	flags.StringVar(&options.Release, "release", "", "the from release: main@<sha> (default: from-dir's commit) or a tag")
	flags.StringVar(&options.RunDir, "run-dir", "", "where logs, shots and the report go (default .claude/tmp/upgradelab/cells/<cell>-<time>)")
	flags.StringVar(&options.PostgresBase, "postgres-base", "", "Postgres server URL with credentials (default: haven db url)")
	flags.StringVar(&options.ClickHouseBase, "clickhouse-base", "", "ClickHouse server URL with credentials (default: haven db url)")
	flags.DurationVar(&options.Before, "before", 30*time.Second, "traffic on the old release before the cut")
	flags.DurationVar(&options.AtCut, "at-cut", 10*time.Second, "traffic with the old worker paused, so jobs queue")
	flags.DurationVar(&options.AfterReady, "after-ready", 20*time.Second, "traffic once head is ready")
	flags.DurationVar(&options.ReadyWithin, "ready-within", 6*time.Minute, "bound on each boot and on head becoming ready")
	flags.DurationVar(&options.SettleWithin, "settle-within", 4*time.Minute, "bound on background steps and queues settling")
	flags.StringVar(&options.SwitchOn, "switch-on", "/readyz", "rolling deploys switch the balancer once head answers 200 here (/readyz, or /healthz for as soon as it listens)")
	flags.DurationVar(&options.WorkerDelay, "worker-delay", 10*time.Second, "head's api starts this long before its worker")
	flags.DurationVar(&options.Rate, "rate", time.Second, "each ingest kind fires once per rate; API kinds slower")
	flags.DurationVar(&options.Hold, "hold", 60*time.Second, "how long a held request may take before it counts as failed")
	flags.StringVar(&options.ServiceBin, "service-bin", ".claude/tmp/upgradelab/bin/service", "the Go service binary hosting storagesim (go build -tags dev -o <path> ./cmd/service), for profiles with object stores")
	flags.BoolVar(&options.Keep, "keep", false, "keep the cell's databases afterwards (kept anyway when a step fails)")
	flags.BoolVar(&options.Shots, "shots", true, "screenshot each api phase and Ops > Upgrades (Playwright from head's apps/ui)")
	drills := flags.String("drills", "", "comma-separated drills on top of the profile: api-early (switch on /healthz), worker-restart, retry")
	if err := flags.Parse(args); err != nil {
		return options, err
	}
	for _, drill := range strings.Split(*drills, ",") {
		switch drill {
		case "":
		case DrillAPIEarly:
			options.SwitchOn = "/healthz"
			options.Drills = append(options.Drills, drill)
		case DrillWorkerRestart, DrillRetry:
			options.Drills = append(options.Drills, drill)
		default:
			return options, fmt.Errorf("unknown drill %q: want %s, %s or %s", drill, DrillAPIEarly, DrillWorkerRestart, DrillRetry)
		}
	}
	return withDefaults(options)
}

func withDefaults(options Options) (Options, error) {
	var err error
	for _, dir := range []*string{&options.FromDir, &options.HeadDir} {
		if *dir, err = filepath.Abs(*dir); err != nil {
			return options, err
		}
	}
	if options.Release == "" {
		out, err := exec.CommandContext(context.Background(), "git", "-C", options.FromDir, "rev-parse", "--short=10", "HEAD").Output() // #nosec G204 -- fixed argv.
		if err != nil {
			return options, fmt.Errorf("from-dir commit: %w", err)
		}
		options.Release = "main@" + strings.TrimSpace(string(out))
	}
	if options.RunDir == "" {
		options.RunDir = filepath.Join(".claude", "tmp", "upgradelab", "cells", options.Name()+"-"+time.Now().Format("0102-150405"))
	}
	options.RunDir, err = filepath.Abs(options.RunDir)
	if err == nil {
		err = os.MkdirAll(options.RunDir, 0o750)
	}
	return options, err
}

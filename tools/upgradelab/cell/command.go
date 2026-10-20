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
	options.Stdout = stdout
	if options, err = withHavenServers(ctx, options); err != nil {
		return 2, err
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
	flags := cellFlags("cell", &options)
	flags.StringVar(&options.FromSnapshot, "from-snapshot", "", "a produce entry directory or cache key: restore it instead of seeding")
	ledger := flags.String("ledger", "", "comma-separated #8553 rows (UP-04, UD-7, ...) to claim at start and report at the end")
	drills := flags.String("drills", "", "comma-separated drills on top of the profile: api-early (switch on /healthz), worker-restart, retry, private-down, route-broken (hybrid), old-worker-lingers (main's worker runs 5 min past the switch)")
	overlays := flags.String("overlays", "", "comma-separated overlays planted on main: retention (aged telemetry under three retention rules), tenant-oddities (held organization, plaintext keys, Postgres dataset rows, untagged prompts; SSO deployments), operator-damage (a failed _prisma_migrations row and a hand-built index under a head migration's name; the cell does each refusal's fix), held-tenants (tenant-oddities' held organization alone; SSO deployments), upcast-events (main's stored types under head's upcast steps, judged V1), queued-jobs-v1 (main's queued jobs by id at the cut, judged Q1)")
	if err := flags.Parse(args); err != nil {
		return options, err
	}
	for _, overlay := range strings.Split(*overlays, ",") {
		if overlay = strings.TrimSpace(overlay); overlay != "" {
			options.Overlays = append(options.Overlays, overlay)
		}
	}
	return withDrills(options, *ledger, *drills)
}

// cellFlags are the flags cell and produce share.
func cellFlags(name string, options *Options) *flag.FlagSet {
	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	flags.StringVar(&options.Deployment, "deployment", "cloud", "cloud | cloud-sso | cloud-legacy-sso | hybrid | self-hosted | self-hosted-legacy-sso")
	flags.StringVar(&options.Tier, "tier", "S", "volume tier: S, M, or L (the long tail, produce snapshots only; XL waits for lane L4)")
	flags.BoolVar(&options.NoAdminEmails, "no-admin-emails", false, "self-hosted-free boots without ADMIN_EMAILS")
	flags.BoolVar(&options.Signups, "signups", false, "once head is ready, two people sign up through its door; P1 judges who may open Ops")
	flags.StringVar(&options.Shape, "shape", "typical", "data shape: typical, or empty (a fresh install: no seed, no traffic)")
	flags.Int64Var(&options.Seed, "seed", 1, "seed for every generated id and payload")
	flags.StringVar(&options.FromDir, "from-dir", ".worktrees/upgradelab-main", "checkout of the release upgraded from (no .env)")
	flags.StringVar(&options.HeadDir, "head-dir", ".worktrees/upgradelab-head", "checkout of the release upgraded to (no .env)")
	flags.StringVar(&options.ViaDir, "via-dir", "", "checkout of a release the operator upgrades to first, between from and head (its own startup migrates; no .env)")
	flags.StringVar(&options.Release, "release", "", "the from release: main@<sha> (default: from-dir's commit) or a tag")
	flags.StringVar(&options.RunDir, "run-dir", "", "where logs, shots and the report go (default .claude/tmp/upgradelab/cells/<cell>-<time>)")
	flags.StringVar(&options.PostgresBase, "postgres-base", "", "Postgres server URL with credentials (default: haven db url)")
	flags.StringVar(&options.ClickHouseBase, "clickhouse-base", "", "ClickHouse server URL with credentials (default: haven db url)")
	flags.StringVar(&options.ClickHouseCluster, "clickhouse-cluster", "", "the -clickhouse-base server is a replica of this cluster: Replicated databases, CLICKHOUSE_CLUSTER on both releases")
	flags.DurationVar(&options.Before, "before", 30*time.Second, "traffic on the old release before the cut")
	flags.DurationVar(&options.AtCut, "at-cut", 10*time.Second, "traffic with the old worker paused, so jobs queue")
	flags.DurationVar(&options.AfterReady, "after-ready", 20*time.Second, "traffic once head is ready")
	flags.DurationVar(&options.ReadyWithin, "ready-within", 6*time.Minute, "bound on each boot and on head becoming ready")
	flags.DurationVar(&options.SettleWithin, "settle-within", 4*time.Minute, "bound on background steps and queues settling")
	flags.StringVar(&options.SwitchOn, "switch-on", "/readyz", "rolling deploys switch the balancer once head answers 200 here (/readyz, or /healthz for as soon as it listens)")
	flags.DurationVar(&options.WorkerDelay, "worker-delay", 10*time.Second, "head's api starts this long before its worker")
	flags.DurationVar(&options.Rate, "rate", time.Second, "each ingest kind fires once per rate; API kinds slower")
	flags.DurationVar(&options.DrainWithin, "drain-within", 60*time.Minute, "produce: bound on main's worker draining the seed backlog before the cut")
	flags.IntVar(&options.DrainNear, "drain-near", 100, "produce: group-queue depth at or below which the backlog counts as drained")
	flags.IntVar(&options.PaceAbove, "pace-above", 50000, "produce, tier M: group-queue depth above which the next telemetry wave waits")
	flags.IntVar(&options.Trickle, "trickle", 300, "produce, tier M: spans sent live after the drain, so the cut still catches in-flight jobs")
	flags.DurationVar(&options.Hold, "hold", 60*time.Second, "how long a held request may take before it counts as failed")
	flags.StringVar(&options.ServiceBin, "service-bin", ".claude/tmp/upgradelab/bin/service", "the Go service binary hosting storagesim (go build -tags dev -o <path> ./cmd/service), for profiles with object stores")
	flags.BoolVar(&options.Keep, "keep", false, "keep the cell's databases afterwards (kept anyway when a step fails)")
	flags.DurationVar(&options.WalkEvery, "walk-every", 10*time.Second, "the browser walker's pause between rounds (one tab); longer cuts Chromium's CPU")
	flags.BoolVar(&options.Shots, "shots", true, "screenshot each api phase and Ops > Upgrades (Playwright from head's apps/ui)")
	flags.BoolVar(&options.ProfilingEnabled, "profile", false, "write node CPU profiles, process and Postgres samples and Redis, Postgres and ClickHouse totals under <run-dir>/profile")
	flags.Float64Var(&options.MaxLoad, "max-load", 40, "refuse to start when the machine's 1-minute load average is above this (0: never refuse)")
	flags.StringVar(&options.TestedBy, "tested-by", "", "who runs the cell, written to the ledger's Tested by: lane:<id> (model) or @handle")
	return flags
}

// apiEarlyUpgradeAllowance: head's api answers upgrade_in_progress until its worker, WorkerDelay later, has run the upgrade.
const apiEarlyUpgradeAllowance = 120 * time.Second

func withDrills(options Options, ledger, drills string) (Options, error) {
	for _, id := range strings.Split(ledger, ",") {
		if id = strings.TrimSpace(id); id != "" {
			options.Ledger = append(options.Ledger, id)
		}
	}
	for _, drill := range strings.Split(drills, ",") {
		switch drill {
		case "":
		case DrillAPIEarly:
			options.SwitchOn = "/healthz"
			options.Hold = max(options.Hold, options.WorkerDelay+apiEarlyUpgradeAllowance)
			options.Drills = append(options.Drills, drill)
		case DrillWorkerRestart, DrillRetry, DrillPrivateDown, DrillRouteBroken, DrillOldWorker:
			options.Drills = append(options.Drills, drill)
		default:
			return options, fmt.Errorf("unknown drill %q: want %s, %s, %s, %s, %s or %s", drill, DrillAPIEarly, DrillWorkerRestart, DrillRetry, DrillPrivateDown, DrillRouteBroken, DrillOldWorker)
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

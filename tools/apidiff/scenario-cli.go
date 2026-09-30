package apidiff

import (
	"cmp"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
	"github.com/langwatch/langwatch/tools/havenrun"
)

// defaultScenarioGlob skips the files whose name starts with an underscore
// (the format's own example), which -scenarios can still name.
const defaultScenarioGlob = "tools/apidiff/scenarios/[a-z]*.yaml"

// scenarioFlags are the flags of the scenario phase, in `run` and `scenarios`.
type scenarioFlags struct {
	glob        string
	ids         scenarioIDs
	concurrency int
	shards      int
	repeat      int
	mailA       string
	mailB       string
	seedDir     string
	final       bool
	trpc        string
	dryRun      bool
	skip        bool
	maxErrors   int
}

func registerScenarioFlags(flags *flag.FlagSet, scenarios *scenarioFlags) {
	flags.StringVar(&scenarios.glob, "scenarios", "", "glob of scenario files (default "+defaultScenarioGlob+")")
	flags.Var(&scenarios.ids, "scenario-id", "only run scenarios whose id matches this pattern, path.Match syntax, or is listed in @FILE one per line (repeatable)")
	flags.IntVar(&scenarios.concurrency, "scenario-concurrency", defaultScenarioConcurrency, "scenarios in flight per side")
	flags.IntVar(&scenarios.shards, "scenario-shards", defaultScenarioShards, "isolated projects and organizations seeded per side for project and org shards")
	flags.IntVar(&scenarios.repeat, "repeat", 1, "debug: run every selected scenario this many times, to measure throughput")
	flags.StringVar(&scenarios.mailA, "mail-a", "", "candidate's mail sink base URL (mailsim), for mail steps")
	flags.StringVar(&scenarios.seedDir, "seed-dir", ".apidiff", "single-sided mode: where the shared-stack seed record and its lock live")
	flags.BoolVar(&scenarios.final, "final", false, "also run the scenarios the done ledger has signed off")
	flags.IntVar(&scenarios.maxErrors, "max-consecutive-errors", defaultMaxConsecutiveErrors, "stop the scenario phase after this many ERROR scenarios in a row, in order of completion (0 never stops it)")
	flags.StringVar(&scenarios.trpc, "trpc-transformer", trpcNone, "single-sided stacks: superjson or none, the tRPC body form the stack speaks (a two-sided run knows: branch none, main superjson)")
	flags.StringVar(&scenarios.mailB, "mail-b", "", "base's mail sink base URL (mailsim), for mail steps")
}

// options builds the phase's options from the probe flags both modes share.
func (scenarios *scenarioFlags) options(probe *probeFlags, runDir string, progress io.Writer) scenarioOptions {
	return scenarioOptions{
		A: probe.a, B: probe.b, MailA: scenarios.mailA, MailB: scenarios.mailB, TRPC: scenarios.trpc, Keys: probe.keys,
		Timeout: probe.timeout, Concurrency: scenarios.concurrency, Shards: scenarios.shards,
		Repeat: scenarios.repeat, Glob: scenarios.glob, IDs: scenarios.ids, RunDir: runDir, Progress: progress,
		SeedDir: scenarios.seedDir, Final: scenarios.final, DryRun: scenarios.dryRun, DoneRoot: ".", MaxErrors: scenarios.maxErrors,
	}
}

func runScenariosSubcommand(ctx context.Context, args []string, out streams) int {
	flags := flag.NewFlagSet("apidiff scenarios", flag.ContinueOnError)
	flags.SetOutput(out.stderr)
	probe := &probeFlags{}
	scenarios := &scenarioFlags{}
	registerProbeFlags(flags, probe)
	registerScenarioFlags(flags, scenarios)
	flags.BoolVar(&scenarios.dryRun, "dry-run", false, "load and validate the scenario files, print what would run and exit")
	runDir := ""
	flags.StringVar(&runDir, "run-dir", "", "directory scenarios.jsonl is written to (default: .apidiff/scenarios-<time>)")
	if err := flags.Parse(args); err != nil {
		return exitError
	}
	fromSuite(probe, scenarios)
	if probe.a == "" && !scenarios.dryRun {
		fmt.Fprintln(out.stderr, "scenarios requires -a (and -b for a comparison; with -a alone the scenarios run against the one stack)")
		return exitError
	}
	if runDir == "" {
		runDir = filepath.Join(".apidiff", "scenarios-"+time.Now().Format("20060102-150405"))
	}
	if probe.a != "" && probe.b != "" {
		if err := rememberHavenOrigins(ctx, probe.a, probe.b); err != nil {
			fmt.Fprintln(out.stderr, "scenarios: haven origins:", err)
		}
	}
	if probe.a != "" && probe.b == "" {
		filled, err := fillHavenCredentials(ctx, probe.a, &probe.keys)
		if err != nil {
			fmt.Fprintln(out.stderr, "scenarios: haven credentials:", err)
		} else if len(filled) > 0 {
			fmt.Fprintln(out.stderr, "scenarios: took from the haven stack:", strings.Join(filled, ", "))
		}
	}
	scenarios.mailA = cmp.Or(scenarios.mailA, serviceMailURL(ctx, probe.a))
	scenarios.mailB = cmp.Or(scenarios.mailB, serviceMailURL(ctx, probe.b))
	return runScenarioPhase(ctx, scenarios.options(probe, runDir, out.stderr), out.stdout, out.stderr)
}

// fromSuite fills the sides diffsuite handed this run that no flag named
// (tools/diffsuite/README.md): -a from its branch stack, -b from its main one.
func fromSuite(probe *probeFlags, scenarios *scenarioFlags) {
	havenrun.TrustLocalRoute()
	if branch, ok := diffkit.SuiteStack(diffkit.SuiteBranch); ok && probe.a == "" {
		probe.a, scenarios.mailA = branch.AppURL, cmp.Or(scenarios.mailA, branch.MailURL)
	}
	if main, ok := diffkit.SuiteStack(diffkit.SuiteMain); ok && probe.b == "" {
		probe.b, scenarios.mailB = main.AppURL, cmp.Or(scenarios.mailB, main.MailURL)
	}
}

// runScenarioAfterMainPass is the phase `run` appends, when scenario files
// exist; the default glob matching nothing is not an error there.
func (probe *probeFlags) runScenarioAfterMainPass(ctx context.Context, out streams) int {
	if probe.scenarios.skip {
		return exitEqual
	}
	options := probe.scenarios.options(probe, probe.runDir, out.stderr)
	if options.Glob == "" {
		options.Glob = defaultScenarioGlob
		if files, _ := filepath.Glob(options.Glob); len(files) == 0 {
			fmt.Fprintf(out.stderr, "scenarios: no file matches %s, phase skipped\n", options.Glob)
			return exitEqual
		}
	}
	return runScenarioPhase(ctx, options, out.stderr, out.stderr)
}

// runScenarioPhase loads, seeds, runs and reports; it answers the exit code.
func runScenarioPhase(ctx context.Context, options scenarioOptions, report, progress io.Writer) int {
	if options.Glob == "" {
		options.Glob = defaultScenarioGlob
	}
	loaded, err := loadScenarios(options.Glob)
	if err != nil {
		fmt.Fprintln(progress, "scenarios:", err)
		return exitError
	}
	items := selectScenarios(loaded, options.IDs)
	if items, err = withoutDone(items, options, progress); err != nil {
		fmt.Fprintln(progress, "scenarios:", err)
		return exitError
	}
	items = repeatScenarios(items, options.Repeat)
	if len(items) == 0 {
		fmt.Fprintln(progress, "scenarios: no scenario selected")
		return exitError
	}
	if options.DryRun {
		fmt.Fprintf(progress, "scenarios: %d valid in %s, %d would run\n", len(loaded), options.Glob, len(items))
		return exitEqual
	}
	runner := newScenarioRunner(ctx, options)
	defer runner.cancel()
	runner.probeAdminKey()
	items, deferred := runner.deferAdminScenarios(items)
	if len(items) == 0 {
		reportDeferred(report, progress, options.RunDir, deferred)
		return exitEqual
	}
	fmt.Fprintf(progress, "scenarios: %d selected, %d in flight per side, %d shards per kind\n", len(items), runner.options.Concurrency, options.Shards)
	seeded := time.Now()
	needs := needsOf(items, options.Shards)
	runner.seed(needs)
	if cause := runner.setupFailure(needs); cause != "" {
		fmt.Fprintln(progress, "apidiff:", diffkit.SetupFailed(errors.New(cause)))
		return exitError
	}
	fmt.Fprintf(progress, "scenarios: shards seeded in %s\n", time.Since(seeded).Round(time.Millisecond))
	phaseDone(progress, "scenario shards", seeded)
	started := time.Now()
	stopTicker := startTicker(progress, "scenarios", len(items), runner.snapshot)
	results := runner.runAll(items)
	stopTicker()
	phaseDone(progress, "scenarios", started)
	timing := scenarioTiming{Wall: time.Since(started), Requests: runner.requests.Load(), Waits: time.Duration(runner.waitNanos.Load()), Workers: runner.options.Concurrency}
	writeScenarioReport(report, results, timing)
	reportDeferred(report, progress, options.RunDir, deferred)
	if target, err := writeScenariosJSONL(options.RunDir, results); err != nil {
		fmt.Fprintln(progress, "scenarios.jsonl:", err)
	} else if target != "" {
		fmt.Fprintln(progress, "scenarios:", target)
	}
	if stopped := runner.streak.Stopped(); stopped != nil {
		fmt.Fprintf(progress, "apidiff: %s\nscenarios: %d of %d not run\n", stopped.Reason, len(items)-len(results), len(items))
		return exitStopped
	}
	return scenarioExit(results)
}

// withoutDone drops the scenarios the done ledger has signed off, unless -final.
func withoutDone(items []scenario, options scenarioOptions, progress io.Writer) ([]scenario, error) {
	if options.Final || options.DoneRoot == "" {
		return items, nil
	}
	ledger, err := loadScenarioDone(options.DoneRoot)
	if err != nil {
		return nil, err
	}
	kept, skipped := ledger.scope(items)
	if len(skipped) > 0 {
		fmt.Fprintf(progress, "scenarios: %d signed off, skipped (-final runs them): %s\n", len(skipped), strings.Join(skipped, ", "))
	}
	return kept, nil
}

// repeatScenarios copies every scenario count times under a suffixed id, so a
// small file measures throughput like a large one.
func repeatScenarios(items []scenario, count int) []scenario {
	if count <= 1 {
		return items
	}
	repeated := make([]scenario, 0, len(items)*count)
	for round := 1; round <= count; round++ {
		for _, item := range items {
			item.ID = fmt.Sprintf("%s-x%d", item.ID, round)
			repeated = append(repeated, item)
		}
	}
	return repeated
}

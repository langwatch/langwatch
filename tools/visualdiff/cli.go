package visualdiff

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

const usage = `visualdiff — render every route and every flow on two refs and diff them

  visualdiff run [-base REF] [-candidate REF] [-routes-only] [-flows a,b]
                 [-viewport 1440x900] [-color-scheme light|dark|both] [-config visualdiff.yaml] [-root DIR]
                 [-base-port N] [-run-dir DIR] [-boot-timeout DUR]
                 [-dry-run] [-keep] [-agent] [-no-haven]
                 [-editions enterprise,free] [-no-baseline] [-refresh-baseline]
                 [-no-fail-fast] [-resume RUNID] [-no-publish] [-include-done]
                 [-rebase-main] [-force] [-max-load N] [-pages N] [-max-consecutive-errors N]
                 [-batch-size N]

  visualdiff flow ID | route PATH [-edition E] [-candidate REF] [-force] [-dev-ui] [-dry-run] [-root DIR]
  visualdiff down [-root DIR]
  visualdiff recapture -run RUNID [-routes a,b] [-flows x,y] [-edition E] [-root DIR]
  visualdiff done -run RUNID (-route PATH | -flow ID) [-edition E] -note WHY [-force]
  visualdiff done -list | -undo KEY
  visualdiff coverage [-base REF] [-candidate REF] [-config FILE] [-root DIR]
  visualdiff gc [-kept] [-no-haven] [-root DIR]
  visualdiff publish -run-dir DIR [-pr N] [-link URL] [-base REF] [-candidate REF] [-root DIR]
  visualdiff batches [-dir OUT] [-wait] [-after N] [-timeout DUR]
  visualdiff batch-review BATCH-DIR

Each ref boots as a haven stack under its own run-scoped slug wherever haven
is installed, so a run never reaches the datastores your own stack uses.
-no-haven boots the old way instead, on -base-port and its ten-above stride,
sharing your own Postgres, ClickHouse and Redis. Every run streams one line
per screen to <run-dir>/findings.jsonl as it decides each one, and a final
run-complete summary line per edition, and <run-dir>/summary.txt (printed on
stdout) says what to look at first: counts per class and edition, coverage,
and the worst findings one line each with their text evidence. stderr is
kept in <run-dir>/run.log.

Findings fail the run: a missing capture on either side, a screen whose own
modules did not load even when taken again alone (capture-failed), a regression, a
screen broken on both refs, a blank or not-found page, a different final
path, a new failed /api/ or tRPC request, a control (button, link, heading,
tab, form field) one side lacks, and every route either ref declares that
visualdiff.yaml neither renders nor excludes. copy, changed,
intended-restore and noise are reported and never fail it.

Every screen is captured once per edition - enterprise (the seeded license)
by default, and free (no license) with -editions enterprise,free - on the
same stacks. Without -base, the base is origin/main pinned at a commit kept
in .visualdiff/baselines/main-pin.json; the pin moves once main has changed
2000 lines since it, or on -rebase-main. The base's captures are cached
under .visualdiff/baselines per base commit, edition and capture settings:
a later run replays them and never boots the base, and a run that adds or
changes routes or flows renders only those on the base and adds them.

A run refuses to start on battery, above -max-load, or beside another live
or kept visualdiff stack; -force runs anyway. Each side captures on -pages
pages, half the CPUs by default and fewer when the load leaves less free.
A run keeps its own directory and the previous run's, and deletes older ones.
The candidate is captured first, and a candidate whose shell does not render
stops the run within its first three routes (-no-fail-fast to carry on).
-resume RUNID continues a -keep run after a fix: its prepared worktrees and
running stacks are reused, so nothing is checked out or installed again.
A route with no finding and a flow judged works are recorded in
.visualdiff/works.json at the candidate commit; a later run skips each while
git diff since that commit is empty over its module (from the screens its
web module declares), the shell packages and apps/ui, and a flow's steps are
unchanged. -include-done, -routes and -flows walk everything named.

flow ID and route PATH are the fix loop: they boot the candidate as a kept
stack under .visualdiff/loop, or reuse it (its worktree follows the
candidate's commit, re-preparing only what changed), run that one section
against main's cached baseline, topping the cache up when it lacks it, and
print its verdict. down stops the loop's stacks.
A finished run shows its largest changes, new failures and key pages on the
open pull request of the checked-out branch, in one comment it edits in place;
-no-publish skips that, as does a missing PR or a gh that is not signed in.

recapture re-renders only the named routes against a run's own stacks - which
stay up when that run was started with -keep - and appends to the same
findings.jsonl. It never checks out a worktree, never runs haven up, and
never tears anything down: pass -keep to run, recapture as many times as a
triage loop needs, then tear the stacks down yourself (haven destroy, or a
fresh run without -keep).

publish shows a finished run's screens on a pull request after the fact:
-pr names it (default: the checked-out branch's open PR) and -link is the
full report's address. It exits 0 when it published, 1 when it skipped and
said why, 2 when it failed.

done keeps a signed-off section's proof (screenshots, aria snapshots, console
and request log, meta.json) under .visualdiff/done/<edition>/<key>, and every
later run skips it; -include-done captures done sections anyway. A section
with any class but noise, copy or intended-restore is refused without -force.

coverage prints the same coverage verdict without booting anything. gc,
which every run also does first, removes what dead runs left behind: their
worktrees, haven stacks and databases, and every orphan visualdiff-* stack;
by hand, it removes run directories older than -older-than.
A -keep run is left alone unless -kept is given.

Exit status: 0 no findings, 1 findings, 2 the run could not be completed, 3 it
stopped early on -max-consecutive-errors captures that were errors, not findings.
`

// Run is the visualdiff CLI. It returns the process exit code.
func Run(ctx context.Context, args []string, streams Streams) int {
	if len(args) == 0 {
		fmt.Fprint(streams.Err, usage)
		return ExitOperational
	}
	switch args[0] {
	case "run":
		return runCommand(ctx, args[1:], streams)
	case "recapture":
		return recaptureCommand(ctx, args[1:], streams)
	case "coverage":
		return coverageCommand(ctx, args[1:], streams)
	case "gc":
		return gcCommand(ctx, args[1:], streams)
	case "publish":
		return publishCommand(ctx, args[1:], streams)
	case "check":
		return checkCommand(ctx, args[1:], streams)
	case "batch-review":
		return batchReviewCommand(args[1:], streams)
	case "batches":
		return batchesCommand(ctx, args[1:], streams)
	case "done":
		return doneCommand(args[1:], streams)
	case "flow", "route":
		return loopCommand(ctx, args[0], args[1:], streams)
	case "down":
		return downCommand(ctx, args[1:], streams)
	case "-h", "--help", "help":
		fmt.Fprint(streams.Out, usage)
		return ExitClean
	default:
		fmt.Fprintf(streams.Err, "visualdiff: unknown command %q\n\n%s", args[0], usage)
		return ExitOperational
	}
}

// runFlags is one parsed `visualdiff run` command line.
type runFlags struct {
	options Options
	config  *Config
	// includeDone captures the done ledger's sections too; otherwise done
	// is the ledger, read before the run starts.
	includeDone bool
	done        DoneLedger
}

func runCommand(ctx context.Context, args []string, streams Streams) int {
	if _, suite := diffkit.SuiteStack(diffkit.SuiteBranch); suite {
		fmt.Fprintln(streams.Err, "visualdiff run: not under diffsuite, which owns the stacks: run boots its own; `visualdiff check -routes` compares diffsuite's")
		return ExitOperational
	}
	parsed, err := parseRunFlags(args, streams.Err)
	if err == nil && !parsed.includeDone {
		parsed.done, err = LoadDoneLedger(parsed.options.Root)
	}
	if err != nil {
		if !errors.Is(err, errFlagsReported) {
			fmt.Fprintln(streams.Err, "visualdiff:", err)
		}
		return ExitOperational
	}
	result, err := Execute(ctx, Request{Options: parsed.options, Config: parsed.config, Done: parsed.done}, streams)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
	}
	if err == nil {
		parsed.publish(ctx, result, streams)
	}
	return ExitCode(result, err)
}

// publish shows a finished run's screens on its branch's pull request. A
// publish that fails is reported and never changes the run's exit code.
func (parsed *runFlags) publish(ctx context.Context, result Result, streams Streams) {
	options := parsed.options
	switch {
	case options.NoPublish:
		fmt.Fprintln(streams.Err, "publish: skipped, -no-publish")
		return
	case options.DryRun || len(result.Rows) == 0:
		return
	}
	_, err := Publish(ctx, PublishRequest{
		Run: execRunner, Root: options.Root, RunDir: result.Plan.RunDir, BaseRef: options.BaseRef,
		CandidateRef: options.CandidateRef, Rows: result.Rows, Findings: result.Findings,
		Config: parsed.config.Publish, Stderr: streams.Err,
	})
	if err != nil {
		fmt.Fprintln(streams.Err, err)
	}
}

// errFlagsReported says the flag package already printed what was wrong, so
// the caller exits without saying it twice.
var errFlagsReported = errors.New("flags rejected")

// parseRunFlags reads the command line and the configuration.
func parseRunFlags(args []string, stderr io.Writer) (*runFlags, error) {
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	flags.SetOutput(stderr)
	baseRef := flags.String("base", "origin/main", "ref to compare against")
	candidateRef := flags.String("candidate", "HEAD", "ref under test")
	root := flags.String("root", ".", "repository root")
	configPath := flags.String("config", "", "configuration file (default <root>/"+ConfigFile+")")
	viewport := flags.String("viewport", "1440x900", "browser viewport, WIDTHxHEIGHT")
	colorScheme := flags.String("color-scheme", "light", "colour scheme to capture: light, dark or both (both keys the dark pass \"<key>@dark\")")
	routesOnly := flags.Bool("routes-only", false, "capture the route list and skip the flows")
	flowList := flags.String("flows", "", "comma-separated flow ids to run; naming any route or flow runs only those")
	routeList := flags.String("routes", "", "comma-separated routes to run, as configured; naming any route or flow runs only those")
	basePort := flags.Int("base-port", DefaultBasePort, "first port of the base stack")
	runDir := flags.String("run-dir", "", "directory for worktrees, logs, screenshots and the report")
	bootTimeout := flags.Duration("boot-timeout", 20*time.Minute, "how long a stack gets to answer (last resort)")
	stall := flags.Duration("stall", 90*time.Second, "fail a booting stack whose logs and lanes do not move for this long; 0 disables")
	smokeTimeout := flags.Duration("smoke-timeout", 30*time.Second, "how long each app entrypoint gets to load its import graph before haven up; 0 skips the smoke")
	dryRun := flags.Bool("dry-run", false, "print the plan and start nothing")
	keep := flags.Bool("keep", false, "leave both stacks and both worktrees up after the run")
	agent := flags.Bool("agent", false, "plain, token-free output for an agent")
	noHaven := flags.Bool("no-haven", false, "do not boot the stacks as haven stacks; use -base-port and share this machine's own databases instead")
	projectKey := flags.String("project-key", DefaultProjectKey, "project key the fixtures are posted with")
	slug := flags.String("slug", "", "project slug the routes are rendered for")
	email := flags.String("email", "", "email the runner signs in with")
	password := flags.String("password", "", "password the runner signs in with")
	editionList := flags.String("editions", "", "comma-separated editions to capture: enterprise, free (default both; enterprise with -no-haven)")
	noBaseline := flags.Bool("no-baseline", false, "render the base every time and cache nothing")
	refreshBaseline := flags.Bool("refresh-baseline", false, "render the base and replace its cached baseline")
	noFailFast := flags.Bool("no-fail-fast", false, "keep capturing even when the candidate's shell does not render")
	fast := flags.Bool("fast", false, "render on a lean Chromium for a quick look; never caches a baseline or publishes to the pull request")
	resume := flags.String("resume", "", "continue a -keep run by id: reuse its worktrees and running stacks")
	noPublish, devUI, includeDone := flags.Bool("no-publish", false, "do not show the run's screens on the branch's pull request"),
		flags.Bool("dev-ui", false, "capture both sides from their Vite dev servers instead of a production build of each UI"),
		flags.Bool("include-done", false, "capture the sections the done ledger holds too")
	rebaseMain := flags.Bool("rebase-main", false, "move the base's pin to -base as it is now, whatever it changed")
	force := flags.Bool("force", false, "run on battery, under load or beside another visualdiff stack")
	maxLoad := flags.Float64("max-load", DefaultMaxLoad, "refuse to start above this 1-minute load average")
	pages := flags.Int("pages", 0, "pages each side captures on at once (default half the CPUs, fewer under load)")
	maxErrors := flags.Int("max-consecutive-errors", DefaultMaxConsecutiveErrors, "stop after this many captures in a row that are harness or stack errors on one side (0 never stops)")
	batchSize := flags.Int("batch-size", DefaultBatchSize, "seal a review batch every this many routes or flows (0 never does)")
	if err := flags.Parse(args); err != nil {
		return nil, errFlagsReported
	}

	absoluteRoot, err := filepath.Abs(*root)
	if err != nil {
		return nil, err
	}
	config, parsedViewport, err := loadRunConfig(flags, runConfigInputs{root: absoluteRoot, configPath: *configPath, routeList: *routeList, flowList: *flowList, viewport: *viewport})
	if err != nil {
		return nil, err
	}

	editions, err := runEditions(*editionList, *noHaven)
	if err != nil {
		return nil, err
	}
	scheme, err := ParseColorScheme(*colorScheme)
	if err != nil {
		return nil, err
	}
	options := Options{
		ColorScheme: scheme,
		Root:        absoluteRoot, BaseRef: *baseRef, CandidateRef: *candidateRef, RunDir: *runDir,
		BasePort: *basePort, Viewport: parsedViewport, RoutesOnly: *routesOnly,
		Agent: *agent, DryRun: *dryRun, Keep: *keep,
		BootTimeout: *bootTimeout, Stall: *stall, SmokeTimeout: *smokeTimeout,
		UseHaven: havenSelected(havenOnPath(), *noHaven),
		Identity: SeedIdentity{
			ProjectKey: *projectKey, Slug: *slug, Email: *email, Password: *password,
		},
		Editions: editions, Baseline: !*noBaseline && !*fast, RefreshBaseline: *refreshBaseline,
		FailFast: !*noFailFast, Fast: *fast, NoPublish: *noPublish || *fast, DevUI: *devUI,
		PinMain: !isFlagSet(flags, "base"), RebaseMain: *rebaseMain, Force: *force, MaxLoad: *maxLoad, Pages: *pages,
		MaxConsecutiveErrors: *maxErrors, BatchSize: *batchSize,
		SkipWorks: !*includeDone && *routeList == "" && *flowList == "",
	}
	resumeRun(&options, *resume)
	return &runFlags{options: options, config: config, includeDone: *includeDone}, nil
}

// resumeRun points a run at the -keep run it continues, when one is named.
func resumeRun(options *Options, runID string) {
	if runID != "" {
		options.Resume, options.RunDir = true, filepath.Join(options.Root, ".visualdiff", runID)
	}
}

// runEditions defaults to both editions, except on -no-haven, whose stacks
// share the developer's own database and so must never have a license cleared.
func runEditions(value string, noHaven bool) ([]Edition, error) {
	if value == "" && noHaven {
		return []Edition{EditionEnterprise}, nil
	}
	return ParseEditions(value)
}

// runConfigInputs carries loadRunConfig's raw flag values, grouped so the
// function itself stays within this repository's argument-count limit.
type runConfigInputs struct {
	root       string
	configPath string
	routeList  string
	flowList   string
	viewport   string
}

// loadRunConfig parses the -viewport flag, resolves the configuration file
// (default <root>/visualdiff.yaml), narrows it to the requested flows, and
// settles the viewport: the command line wins when given, the configured one
// otherwise.
func loadRunConfig(flags *flag.FlagSet, inputs runConfigInputs) (*Config, Viewport, error) {
	parsedViewport, err := ParseViewport(inputs.viewport)
	if err != nil {
		return nil, Viewport{}, err
	}
	path := inputs.configPath
	if path == "" {
		path = filepath.Join(inputs.root, ConfigFile)
	}
	config, err := LoadConfig(path)
	if err != nil {
		return nil, Viewport{}, err
	}
	config, err = config.Select(splitList(inputs.routeList), splitList(inputs.flowList))
	if err != nil {
		return nil, Viewport{}, err
	}
	if !isFlagSet(flags, "viewport") {
		parsedViewport = configuredViewport(config, parsedViewport)
	}
	return config, parsedViewport, nil
}

// configuredViewport takes the configured viewport when there is one, and the
// command line's otherwise.
func configuredViewport(config *Config, fallback Viewport) Viewport {
	if config.Viewport == "" {
		return fallback
	}
	parsed, err := ParseViewport(config.Viewport)
	if err != nil {
		return fallback
	}
	return parsed
}

// isFlagSet reports whether the operator gave a flag, so a configured
// viewport never overrides one asked for on the command line.
func isFlagSet(flags *flag.FlagSet, name string) bool {
	given := false
	flags.Visit(func(f *flag.Flag) {
		if f.Name == name {
			given = true
		}
	})
	return given
}

func splitList(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// recaptureFlags is one parsed `visualdiff recapture` command line.
type recaptureFlags struct {
	root    string
	runID   string
	routes  []string
	flows   []string
	edition Edition
}

func recaptureCommand(ctx context.Context, args []string, streams Streams) int {
	parsed, err := parseRecaptureFlags(args, streams.Err)
	if err != nil {
		if !errors.Is(err, errFlagsReported) {
			fmt.Fprintln(streams.Err, "visualdiff:", err)
		}
		return ExitOperational
	}
	result, err := Recapture(ctx, RecaptureRequest{
		Root: parsed.root, RunID: parsed.runID, Routes: parsed.routes, Flows: parsed.flows, Edition: parsed.edition,
	}, streams)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
		return ExitCode(Result{}, err)
	}
	if result.Findings > 0 {
		return ExitFindings
	}
	return ExitClean
}

func parseRecaptureFlags(args []string, stderr io.Writer) (*recaptureFlags, error) {
	flags := flag.NewFlagSet("recapture", flag.ContinueOnError)
	flags.SetOutput(stderr)
	root := flags.String("root", ".", "repository root")
	runID := flags.String("run", "", "run id to recapture against (an earlier -keep run's .visualdiff/<runID> directory)")
	routes := flags.String("routes", "", "comma-separated routes to recapture")
	flowList := flags.String("flows", "", "comma-separated flow ids to recapture")
	edition := flags.String("edition", string(EditionEnterprise), "edition pass to recapture: enterprise or free")
	if err := flags.Parse(args); err != nil {
		return nil, errFlagsReported
	}
	if *runID == "" {
		return nil, errors.New("recapture: -run is required")
	}
	routeList, flowIDs := splitList(*routes), splitList(*flowList)
	if len(routeList) == 0 && len(flowIDs) == 0 {
		return nil, errors.New("recapture: -routes or -flows is required")
	}
	editions, err := ParseEditions(*edition)
	if err != nil || len(editions) != 1 {
		return nil, fmt.Errorf("recapture: -edition wants exactly one of enterprise or free")
	}
	absoluteRoot, err := filepath.Abs(*root)
	if err != nil {
		return nil, err
	}
	return &recaptureFlags{root: absoluteRoot, runID: *runID, routes: routeList, flows: flowIDs, edition: editions[0]}, nil
}

package visualdiff

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Options is one `visualdiff run` invocation.
type Options struct {
	Root         string
	BaseRef      string
	CandidateRef string
	RunDir       string
	BasePort     int
	Viewport     Viewport
	RoutesOnly   bool
	Agent        bool
	DryRun       bool
	Keep         bool
	BootTimeout  time.Duration
	Identity     SeedIdentity
	TraceCount   int
	// UseHaven boots each stack as a haven stack under its own run-scoped
	// slug instead of provisioning its own ports and sharing the developer's
	// own Postgres, ClickHouse and Redis. Default wherever haven is
	// installed; see haven.go for why.
	UseHaven bool
	// Editions are the license states every screen is captured under, one
	// pass each on the same stacks (edition.go).
	Editions []Edition
	// Baseline replays a cached base when one exists and caches a live one
	// otherwise; RefreshBaseline renders it and replaces the cached one
	// (baseline.go).
	Baseline        bool
	RefreshBaseline bool
	// FailFast aborts the capture once the candidate's shell does not render.
	FailFast bool
	// Resume continues a -keep run in RunDir: its prepared worktrees and
	// running stacks are reused, and its fixtures are not seeded twice.
	Resume bool
	// NoPublish keeps the run's screens off its branch's pull request.
	NoPublish bool
	// DevUI captures both sides from their Vite dev servers instead of a
	// production build of each side's UI (ui_build.go).
	DevUI bool
	// PinMain renders BaseRef at its pinned commit (pin.go); RebaseMain moves the pin.
	PinMain    bool
	RebaseMain bool
	// Force runs despite the machine conditions a run refuses (conditions.go);
	// MaxLoad is the 1-minute load average above which it refuses.
	Force   bool
	MaxLoad float64
	// Pages is how many pages each side captures on at once; zero is half the CPUs.
	Pages int
}

// Streams are where a run writes: the summary on Out, everything a person
// reads while it works on Err.
type Streams struct {
	Out io.Writer
	Err io.Writer
}

// Deps are the boundaries the run drives. Every one of them has a real
// implementation used by the CLI and a fake used by the tests, which is what
// lets a test assert that teardown happened after a failed capture without
// booting anything.
type Deps struct {
	Run     runner
	Start   func(ctx context.Context, stack Stack, logDir string) (func(), error)
	Wait    func(ctx context.Context, urls []string, timeout time.Duration) error
	Seed    func(ctx context.Context, request SeedRequest) (SeedResult, error)
	Capture func(ctx context.Context, plan RunnerPlan, options CaptureOptions) (RunnerStream, error)
	// Preflight proves the runner can launch its browser before any stack
	// boots, so a missing Playwright install fails in seconds, not minutes.
	Preflight     func(ctx context.Context, root string) error
	Listening     func(port int) bool
	Layout        func(dir string) (Layout, error)
	Now           func() time.Time
	AllocateRedis func(ctx context.Context) (RedisAllocation, error)
	// Environ is the process environment haven commands are composed from on
	// the haven path. Defaults to os.Environ; tests supply their own so a
	// developer's own DATABASE_URL etc. never has to exist on the machine
	// running the test.
	Environ func() []string
	// CopyEnv copies the developer's own .env* files from root (the main
	// checkout) into dir (a fresh worktree) before that worktree's haven
	// prepare steps run - see CopyEnvFiles in haven.go. Tests supply their
	// own so a fake root path never has to exist on disk.
	CopyEnv func(ctx context.Context, root, dir string) (int, error)
	// Detach starts a command that outlives the run, its output appended to
	// log: the haven path's teardown, which nothing has to wait on.
	Detach func(spec commandSpec, log string) error
	// BuildUI builds one side's UI for production (BuildUIDist). Only the
	// real runner gets it by default, so a test's fake capture never builds.
	BuildUI func(ctx context.Context, request UIBuildRequest) (UIBuild, error)
	// Conditions reads the machine a run refuses to start on (conditions.go).
	// Only the real runner gets it by default, so a test never reads the load.
	Conditions func(ctx context.Context, options Options) Conditions
}

// Request is everything Execute needs: what to run, what to render, and what
// to run it through.
type Request struct {
	Options Options
	Config  *Config
	Deps    Deps
	// Done is the ledger whose sections the run skips (done.go); the CLI
	// leaves it empty on -include-done.
	Done DoneLedger
}

// Result is what a finished run produced.
type Result struct {
	Rows      []Row
	Findings  int
	ReportDir string
	Plan      Plan
	Coverage  *Coverage
	Summary   string
}

// Exit codes, matching apidiff: 0 clean, 1 differences worth a person's
// attention, 2 the tool could not do its job.
const (
	ExitClean       = 0
	ExitFindings    = 1
	ExitOperational = 2
)

// ExitCode maps a finished run onto its process exit status.
func ExitCode(result Result, err error) int {
	if err != nil {
		return ExitOperational
	}
	if result.Findings > 0 {
		return ExitFindings
	}
	return ExitClean
}

func (deps *Deps) fill() {
	if deps.Run == nil {
		deps.Run = execRunner
	}
	if deps.Wait == nil {
		deps.Wait = func(ctx context.Context, urls []string, timeout time.Duration) error {
			return WaitForListeners(ctx, urls, WaitOptions{Timeout: timeout})
		}
	}
	if deps.Seed == nil {
		deps.Seed = Seed
	}
	if deps.Listening == nil {
		deps.Listening = PortListening
	}
	if deps.Layout == nil {
		deps.Layout = DetectLayout
	}
	if deps.Now == nil {
		deps.Now = time.Now
	}
	deps.fillPreflight()
	if deps.Capture == nil {
		deps.Capture = RunRunner
	}
	if deps.Start == nil {
		deps.Start = StartStack
	}
	if deps.AllocateRedis == nil {
		deps.AllocateRedis = ResolveRedisAllocation
	}
	deps.fillHaven()
}

// prepareInfra proves the runner's browser launches, then (off haven) takes
// ports and Redis databases; haven owns both on its own path.
func prepareInfra(ctx context.Context, inputs portInfraInputs, options Options) error {
	if err := inputs.deps.Preflight(ctx, options.Root); err != nil {
		return err
	}
	if options.UseHaven {
		return nil
	}
	return resolvePortBasedInfra(ctx, inputs)
}

// fillPreflight runs the real browser check only with the real runner, so a
// test's fake capture never shells out.
func (deps *Deps) fillPreflight() {
	if deps.Preflight != nil {
		return
	}
	deps.Preflight = func(context.Context, string) error { return nil }
	if deps.Capture == nil {
		deps.Preflight = RunnerPreflight
		if deps.BuildUI == nil {
			deps.BuildUI = BuildUIDist
		}
		if deps.Conditions == nil {
			deps.Conditions = ReadConditions
		}
	}
}

// fillHaven defaults the two dependencies only the haven path uses, split out
// of fill so that function's cognitive complexity stays under the repository
// limit.
func (deps *Deps) fillHaven() {
	if deps.Environ == nil {
		deps.Environ = os.Environ
	}
	if deps.CopyEnv == nil {
		deps.CopyEnv = CopyEnvFiles
	}
	if deps.Detach == nil {
		deps.Detach = detachCommand
	}
}

func (options *Options) fill(now func() time.Time) {
	if options.BasePort == 0 {
		options.BasePort = DefaultBasePort
	}
	if options.BootTimeout == 0 {
		options.BootTimeout = 20 * time.Minute
	}
	if options.MaxLoad == 0 {
		options.MaxLoad = DefaultMaxLoad
	}
	if options.TraceCount == 0 {
		options.TraceCount = 6
	}
	if options.RunDir == "" {
		options.RunDir = filepath.Join(options.Root, ".visualdiff", now().Format(RunTimeLayout))
	}
	if len(options.Editions) == 0 {
		options.Editions = []Edition{EditionEnterprise}
	}
	options.Identity = options.Identity.withSeededDefaults()
}

// Execute is the whole run. Teardown is deferred before the first worktree
// exists, so every exit path — a failed install, a stack that never answers,
// a capture that throws, a canceled context — still frees the ports and
// removes the worktrees.
func Execute(ctx context.Context, request Request, streams Streams) (Result, error) {
	request.Deps.fill()
	request.Options.fill(request.Deps.Now)
	if err := refuse(ctx, &request, streams.Err); err != nil {
		return Result{}, err
	}

	finish, err := startRun(ctx, request, &streams)
	defer finish()
	if err != nil {
		return Result{}, err
	}
	clock := &phaseClock{stderr: streams.Err}
	defer func() {
		if err := appendPhases(request.Options.RunDir, clock); err != nil {
			fmt.Fprintf(streams.Err, "phases: %v\n", err)
		}
	}()
	if request.Options.PinMain {
		request.Options.BaseRef = pinMain(ctx, request, streams.Err)
	}
	options, config, deps := request.Options, request.Config, request.Deps
	plan := buildPlan(options, config)
	result := Result{Plan: plan, Coverage: runCoverage(ctx, request, streams.Err)}
	baselines, err := planBaselines(ctx, baselineInputs{options: options, config: config, deps: deps, done: request.Done}, streams.Err)
	if err != nil {
		return result, err
	}
	plan.ReplayBase = !needsLiveBase(options.Editions, baselines)
	result.Plan = plan

	if options.DryRun {
		writePlan(streams.Out, plan, options.RoutesOnly)
		request.Done.writeSkips(streams.Out, config, options.Editions)
		writeBaselinePlan(streams.Out, options.Editions, baselines)
		return result, nil
	}
	writeBaselinePlan(streams.Err, options.Editions, baselines)
	request.Done.writeSkips(streams.Err, config, options.Editions)
	if err := prepareInfra(ctx, portInfraInputs{plan: &plan, deps: deps, stderr: streams.Err}, options); err != nil {
		return result, err
	}
	result.Plan = plan

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if err := claimWorktrees(&plan, options); err != nil {
		return result, err
	}
	result.Plan = plan
	run := &session{
		request: request, streams: streams, plan: plan, runID: plan.RunID, phases: clock,
		stagger: staggers(plan, options) && !anyPartial(baselines),
	}
	// Registered first, so it runs last: the lanes (or the haven stacks) are
	// stopped, and only then are the worktrees removed.
	defer func() {
		started := time.Now()
		if err := run.teardown(context.WithoutCancel(ctx)); err != nil {
			fmt.Fprintln(streams.Err, err)
		}
		clock.since("teardown", started)
	}()
	defer run.stopAll()

	if err := run.boot(ctx); err != nil {
		return result, err
	}
	captured, err := run.captureEditions(ctx, baselines)
	captured.Coverage = result.Coverage
	if err != nil {
		return captured, err
	}
	return run.finish(captured)
}

// boot brings both stacks up through haven, or by hand with -no-haven.
func (run *session) boot(ctx context.Context) error {
	if run.request.Options.UseHaven {
		return run.bringUpHaven(ctx)
	}
	return run.bringUp(ctx)
}

// planBaselines refuses an edition the run could not safely set, then finds
// the baselines. A base that cannot be resolved only turns caching off.
func planBaselines(ctx context.Context, inputs baselineInputs, stderr io.Writer) (map[Edition]Baseline, error) {
	if !inputs.options.UseHaven && hasEdition(inputs.options.Editions, EditionFree) {
		return nil, fmt.Errorf("the free edition clears the organization's license, and -no-haven shares your own database: pass -editions enterprise")
	}
	baselines, err := resolveBaselines(ctx, inputs)
	if err != nil {
		fmt.Fprintf(stderr, "baseline: off for this run, the base renders live: %v\n", err)
		return map[Edition]Baseline{}, nil
	}
	return baselines, nil
}

// anyPartial reports an edition whose baseline this run tops up.
func anyPartial(baselines map[Edition]Baseline) bool {
	for _, baseline := range baselines {
		if baseline.Partial() {
			return true
		}
	}
	return false
}

func hasEdition(editions []Edition, wanted Edition) bool {
	for _, edition := range editions {
		if edition == wanted {
			return true
		}
	}
	return false
}

// buildPlan decides both stacks' identities: ports and a Redis placeholder on
// the port-based path, a run-scoped haven slug and no port of its own on the
// haven path. Carrying the port-based plan's numbers forward on the haven
// path would read as this tool having allocated them.
func buildPlan(options Options, config *Config) Plan {
	runID := RunID(options.RunDir)
	base, candidate := PlanStacks(options.BasePort, Refs{Base: options.BaseRef, Candidate: options.CandidateRef}, options.RunDir)
	if options.UseHaven {
		base.HavenSlug, base.Ports, base.BasePort = HavenSlug(runID, base.Name), Ports{}, 0
		candidate.HavenSlug, candidate.Ports, candidate.BasePort = HavenSlug(runID, candidate.Name), Ports{}, 0
	}
	plan := Plan{
		Base: base, Candidate: candidate, Viewport: options.Viewport, RunDir: options.RunDir,
		RoutesOnly: options.RoutesOnly, RouteCount: len(config.Routes), FlowIDs: flowIDs(config),
		UseHaven: options.UseHaven, RunID: runID,
	}
	if options.RoutesOnly {
		plan.FlowIDs = nil
	}
	return plan
}

// portInfraInputs carries resolvePortBasedInfra's inputs, grouped so the
// function itself stays within this repository's argument-count limit.
type portInfraInputs struct {
	plan   *Plan
	deps   Deps
	stderr io.Writer
}

// resolvePortBasedInfra is the port-based path's only two shared-machine
// concerns: refusing a port something else already holds, and allocating
// this run's two Redis databases. Allocated last, right before anything
// boots: a dry run never reaches here.
func resolvePortBasedInfra(ctx context.Context, inputs portInfraInputs) error {
	plan := inputs.plan
	if held := heldPorts(plan.AllPorts(), inputs.deps.Listening); len(held) > 0 {
		return fmt.Errorf("ports %s are already in use - another stack is up; pass -base-port to move both stacks",
			renderPorts(held))
	}
	redisAllocation, err := inputs.deps.AllocateRedis(ctx)
	if err != nil {
		return fmt.Errorf("redis allocation: %w", err)
	}
	plan.Base.RedisDBIndex = strconv.Itoa(redisAllocation.Base)
	plan.Candidate.RedisDBIndex = strconv.Itoa(redisAllocation.Candidate)
	fmt.Fprintf(inputs.stderr, "redis: base db %s, candidate db %s\n", plan.Base.RedisDBIndex, plan.Candidate.RedisDBIndex)
	return nil
}

// teardown frees whatever this run started: the haven stacks and the
// worktrees on the haven path, the local lanes and the worktrees otherwise.
func (run *session) teardown(ctx context.Context) error {
	if run.request.Options.UseHaven {
		return run.teardownHaven(ctx)
	}
	options, deps := run.request.Options, run.request.Deps
	teardown := Teardown{Root: options.Root, Run: deps.Run, Listening: deps.Listening, Log: run.streams.Err, Keep: options.Keep}
	return teardown.Do(ctx, run.plan.AllPorts(), run.created)
}

// session is one run in progress: the plan it decided, the worktrees it has
// created so far, and the lanes it has started (or, on the haven path, the
// haven stacks it has started).
type session struct {
	request Request
	streams Streams
	plan    Plan
	created []string
	stops   []func()
	// runID identifies this run for haven slug naming (see haven.go). Empty
	// runs never reach the haven path.
	runID string
	// havenSlugs are the stacks this run started, in order. Teardown destroys
	// these and nothing else.
	havenSlugs []string
	// sideFixtures are the ids each side's seed generated, by stack name.
	sideFixtures map[string]map[string]string
	// logOffsets are each started stack's log size at its `haven up`, so a
	// fatal line an earlier up of the same slug wrote is never read as this one's.
	logOffsets map[string]int64
	// stagger lets the candidate capture while the base still boots; the
	// base arrives on baseArrival, ready and seeded, once it can (haven.go).
	stagger     bool
	baseArrival <-chan baseArrival
	// staticDirs are the built UIs by stack name; a live side without one is
	// captured from its dev server.
	staticDirs map[string]string
	// phases times the run (phases.go); upAt is when each stack's haven up ran.
	phases *phaseClock
	upAt   map[string]time.Time
}

func (run *session) stopAll() {
	for _, stop := range run.stops {
		stop()
	}
}

// bringUp checks out both refs, prepares them, starts every lane and waits
// for each listener. It records every worktree it creates as it goes, so a
// failure halfway through still tears down exactly what exists.
func (run *session) bringUp(ctx context.Context) error {
	options, deps := run.request.Options, run.request.Deps
	logDir := filepath.Join(options.RunDir, "logs")
	if err := os.MkdirAll(logDir, 0o750); err != nil {
		return err
	}
	stacks := run.liveStacks()
	for _, stack := range stacks {
		if err := run.checkout(ctx, stack); err != nil {
			return err
		}
	}
	for _, stack := range stacks {
		if err := run.start(ctx, *stack, logDir); err != nil {
			return err
		}
	}
	for _, stack := range stacks {
		fmt.Fprintf(run.streams.Err, "%s: waiting for %s\n", stack.Name, strings.Join(stack.ReadinessURLs(), ", "))
		if err := deps.Wait(ctx, stack.ReadinessURLs(), options.BootTimeout); err != nil {
			return fmt.Errorf("%s never became ready: %w", stack.Name, err)
		}
	}
	return nil
}

// start spawns one stack's lanes, recording how to stop them even when the
// start itself failed part-way through.
func (run *session) start(ctx context.Context, stack Stack, logDir string) error {
	stop, err := run.request.Deps.Start(ctx, stack, logDir)
	if stop != nil {
		run.stops = append(run.stops, stop)
	}
	if err != nil {
		return fmt.Errorf("start %s: %w", stack.Name, err)
	}
	return nil
}

// checkout adds one ref's worktree, detects its layout and prepares it.
func (run *session) checkout(ctx context.Context, stack *Stack) error {
	steps := &executor{run: run.request.Deps.Run, root: run.request.Options.Root, stderr: run.streams.Err}
	if err := steps.addWorktree(ctx, *stack); err != nil {
		return err
	}
	run.created = append(run.created, stack.Dir)
	layout, err := run.request.Deps.Layout(stack.Dir)
	if err != nil {
		return err
	}
	stack.Layout = layout
	fmt.Fprintf(run.streams.Err, "%s: %s at %s (%s layout)\n", stack.Name, stack.Ref, stack.Dir, layout)
	return steps.prepare(ctx, *stack)
}

// liveStacks are the stacks this run boots: the candidate always, the base
// only when some edition has no cached baseline to replay.
func (run *session) liveStacks() []*Stack {
	if run.plan.ReplayBase {
		return []*Stack{&run.plan.Candidate}
	}
	return []*Stack{&run.plan.Base, &run.plan.Candidate}
}

// editionStacks are the live haven stacks an edition switch reaches.
func (run *session) editionStacks() []EditionStack {
	if !run.request.Options.UseHaven {
		return nil
	}
	stacks := make([]EditionStack, 0, 2)
	for _, stack := range run.liveStacks() {
		stacks = append(stacks, EditionStack{Name: stack.Name, Slug: stack.HavenSlug, Dir: stack.Dir})
	}
	return stacks
}

// seed posts the fixtures. Haven stacks each own their database, so every
// live one is seeded; the port-based stacks share one, seeded once through
// the candidate so the rows are in the shape the newer code writes. The ids
// each side generated are kept in the marker, so a resumed run renders them.
func (run *session) seed(ctx context.Context) error {
	options, deps := run.request.Options, run.request.Deps
	marker := filepath.Join(options.RunDir, "seeded")
	if recorded, err := os.ReadFile(marker); err == nil {
		fmt.Fprintln(run.streams.Err, "seed: this run's stacks are already seeded")
		run.sideFixtures = ReadSeededMarker(recorded)
		return nil
	}
	started := time.Now()
	fixtures, err := run.seedStacks(ctx, options, deps)
	if err != nil {
		return err
	}
	run.phases.since("seed", started)
	run.sideFixtures = fixtures
	if err := os.MkdirAll(options.RunDir, 0o750); err != nil {
		return err
	}
	encoded, err := json.Marshal(fixtures)
	if err != nil {
		return err
	}
	return os.WriteFile(marker, encoded, 0o600)
}

// seedStacks posts the fixtures to each stack that owns a database and
// returns each side's seeded ids. A shared database gives both sides the
// candidate's.
func (run *session) seedStacks(ctx context.Context, options Options, deps Deps) (map[string]map[string]string, error) {
	stacks := []*Stack{&run.plan.Candidate}
	if options.UseHaven && run.baseArrival == nil {
		stacks = run.liveStacks()
	}
	fixtures := map[string]map[string]string{}
	for _, stack := range stacks {
		seed := SeedRequest{APIURL: stack.APIURL(), Identity: options.Identity, TraceCount: options.TraceCount}
		result, err := deps.Seed(ctx, seed)
		if err != nil {
			return nil, fmt.Errorf("seed %s: %w", stack.Name, err)
		}
		for _, warning := range result.Warnings {
			fmt.Fprintf(run.streams.Err, "seed %s: %s\n", stack.Name, warning)
		}
		fixtures[stack.Name] = result.Fixtures
	}
	if !options.UseHaven {
		fixtures[run.plan.Base.Name] = fixtures[run.plan.Candidate.Name]
	}
	return fixtures, nil
}

// ReadSeededMarker reads the per-side fixtures a seed recorded. A marker an
// older run left empty reads as no fixtures.
func ReadSeededMarker(recorded []byte) map[string]map[string]string {
	fixtures := map[string]map[string]string{}
	if len(recorded) > 0 {
		_ = json.Unmarshal(recorded, &fixtures)
	}
	return fixtures
}

// captureEditions seeds once, then runs one capture pass per edition on the
// same stacks, flipping the license between passes.
func (run *session) captureEditions(ctx context.Context, baselines map[Edition]Baseline) (Result, error) {
	options, deps := run.request.Options, run.request.Deps
	total := Result{Plan: run.plan, ReportDir: filepath.Join(options.RunDir, "report")}
	if err := run.seed(ctx); err != nil {
		return total, err
	}
	seeded := EditionEnterprise
	if options.Resume {
		seeded = ""
	}
	switcher := newEditionSwitch(deps.Run, deps.Environ, seeded)
	for _, edition := range options.Editions {
		rows, err := run.captureEdition(ctx, editionPass{switcher: switcher, edition: edition, baseline: baselines[edition]})
		if err != nil {
			return total, err
		}
		total.Rows = append(total.Rows, rows...)
		total.Findings += CountFindings(rows)
	}
	total.Plan = run.plan
	return total, nil
}

// editionPass is one edition's capture: the license to set, and the
// baseline to replay or fill.
type editionPass struct {
	switcher *editionSwitch
	edition  Edition
	baseline Baseline
}

// captureEdition sets the license, captures, caches a live base pass as that
// edition's baseline, and writes the edition's report.
func (run *session) captureEdition(ctx context.Context, pass editionPass) ([]Row, error) {
	if run.request.Options.UseHaven {
		fmt.Fprintf(run.streams.Err, "edition: %s\n", pass.edition)
		if err := pass.switcher.Set(ctx, pass.edition, run.editionStacks()); err != nil {
			return nil, err
		}
	}
	if pass.baseline.Partial() {
		pass.baseline = run.fillBaseline(ctx, pass.edition, pass.baseline)
	}
	stream, err := run.capture(ctx, pass.edition, pass.baseline)
	if err != nil {
		return nil, err
	}
	run.cacheBaseline(pass.baseline, stream)
	return run.report(stream, pass.edition)
}

// cacheBaseline keeps a live base pass for the next run. A failure to cache
// costs the next run a boot, never this run its result.
func (run *session) cacheBaseline(baseline Baseline, stream RunnerStream) {
	if baseline.Cached || baseline.Dir == "" {
		return
	}
	if err := run.cacheRefusal(stream.Captures); err != nil {
		fmt.Fprintf(run.streams.Err, "baseline: not cached, %v\n", err)
		return
	}
	if err := SaveBaseline(baseline, stream.Captures); err != nil {
		fmt.Fprintf(run.streams.Err, "baseline: could not cache %s: %v\n", baseline.Dir, err)
		return
	}
	fmt.Fprintf(run.streams.Err, "baseline: cached %s for the next run\n", baseline.Dir)
}

// cacheRefusal says why base captures must not enter a baseline, or nil.
func (run *session) cacheRefusal(captures []Capture) error {
	if run.request.Deps.BuildUI != nil && !run.request.Options.DevUI && run.staticDirs[run.plan.Base.Name] == "" {
		return errors.New("the base was captured from its dev server, not its build")
	}
	if unloaded := UnloadedBaseCaptures(captures); unloaded > 0 {
		return fmt.Errorf("%d base capture(s) did not load their own modules", unloaded)
	}
	return nil
}

// concurrency is the pages each side captures on: -pages when resolved, else the configuration's.
func (run *session) concurrency(config *Config) Concurrency {
	if pages := run.request.Options.Pages; pages > 0 {
		return Concurrency{Routes: pages, Flows: pages}
	}
	return config.Concurrency
}

// capture drives the runner over both sides for one edition: the base from
// its baseline when one is cached, live otherwise.
func (run *session) capture(ctx context.Context, edition Edition, baseline Baseline) (RunnerStream, error) {
	options, deps := run.request.Options, run.request.Deps
	config, _ := run.request.Done.Scope(run.request.Config, edition)
	plan := run.plan
	base := RunnerSide{Name: "base", BaseURL: plan.Base.URL(), Fixtures: run.sideFixtures[plan.Base.Name], StaticDir: run.staticDirs[plan.Base.Name]}
	if baseline.Cached {
		base = RunnerSide{Name: "base", Replay: baseline.CapturesPath()}
		fmt.Fprintf(run.streams.Err, "%s: base replayed from %s\n", edition, baseline.Dir)
	}
	runnerPlan := RunnerPlan{
		Viewport: options.Viewport,
		Settle:   config.Settle,
		Sides: []RunnerSide{base, {
			Name: "candidate", BaseURL: plan.Candidate.URL(), Fixtures: run.sideFixtures[plan.Candidate.Name],
			StaticDir: run.staticDirs[plan.Candidate.Name],
		}},
		OutDir:      filepath.Join(options.RunDir, "shots", string(edition)),
		Slug:        options.Identity.Slug,
		Routes:      config.Routes,
		Credential:  options.Identity,
		FailFast:    options.FailFast,
		FrozenTime:  deps.Now().UnixMilli(),
		Fixtures:    config.Fixtures,
		Concurrency: run.concurrency(config),
		Edition:     edition,
		Stacks:      run.editionStacks(),
	}
	if !options.RoutesOnly {
		runnerPlan.Flows = config.Flows
	}
	var arrived <-chan baseArrival
	if run.baseArrival != nil && !baseline.Cached {
		pending := filepath.Join(options.RunDir, PendingBaseFile)
		runnerPlan.Sides[0] = RunnerSide{Name: "base", Pending: pending}
		arrived = run.forwardBase(ctx, pending)
	}
	findingsPath := filepath.Join(options.RunDir, FindingsFile)
	started := time.Now()
	stream, err := runWithFindings(ctx, findingsRunInputs{
		Deps: deps, Plan: runnerPlan, Options: CaptureOptions{Root: options.Root, Stderr: run.streams.Err},
		FindingsPath: findingsPath, CatalogueRoot: options.Root, Edition: edition,
	})
	run.phases.recordRunnerPhases(string(edition), stream.Phases)
	run.phases.since(string(edition)+" runner", started)
	if err != nil {
		return stream, fmt.Errorf("capture %s: %w", edition, err)
	}
	if arrived != nil {
		if err := run.adoptBase(ctx, arrived); err != nil {
			return stream, err
		}
	}
	return stream, nil
}

// report classifies one edition's captures and writes its three artifacts.
func (run *session) report(stream RunnerStream, edition Edition) ([]Row, error) {
	options, plan := run.request.Options, run.plan
	rows := BuildRows(stream.Captures, stream.Diffs)
	for index := range rows {
		rows[index].Edition = edition
	}
	dir := filepath.Join(options.RunDir, "report", string(edition))
	meta := ReportMeta{
		BaseRef: options.BaseRef, CandidateRef: options.CandidateRef + " (" + string(edition) + ")",
		BaseURL: plan.Base.URL(), CandidateURL: plan.Candidate.URL(),
		Viewport: options.Viewport.String(), StartedAt: run.request.Deps.Now().Format(time.RFC3339),
	}
	meta.BaseCommit, _ = resolveCommit(context.Background(), gitRef{run: run.request.Deps.Run, root: options.Root, ref: options.BaseRef})
	meta.CandidateCommit, _ = resolveCommit(context.Background(), gitRef{run: run.request.Deps.Run, root: options.Root, ref: options.CandidateRef})
	if err := WriteReport(dir, rows, meta); err != nil {
		return rows, fmt.Errorf("write %s report: %w", edition, err)
	}
	fmt.Fprintf(run.streams.Err, "%s: %d rows, %d findings — %s\n", edition, len(rows), CountFindings(rows), filepath.Join(dir, "report.html"))
	return rows, nil
}

// finish records every uncovered route as a finding, then writes
// summary.txt and prints it.
func (run *session) finish(result Result) (Result, error) {
	options := run.request.Options
	if result.Coverage != nil {
		uncovered := result.Coverage.Uncovered()
		if err := appendUncovered(filepath.Join(options.RunDir, FindingsFile), uncovered, run.request.Deps.Now()); err != nil {
			fmt.Fprintf(run.streams.Err, "findings: could not record uncovered routes: %v\n", err)
		}
		result.Findings += len(uncovered)
	}
	summary := RenderSummary(SummaryInputs{
		BaseRef: options.BaseRef, CandidateRef: options.CandidateRef, Editions: options.Editions,
		Rows: result.Rows, Coverage: result.Coverage,
	})
	if err := WriteSummaryFile(options.RunDir, summary); err != nil {
		return result, fmt.Errorf("write summary: %w", err)
	}
	if err := WriteVerdictFile(options.RunDir, result.Rows); err != nil {
		return result, fmt.Errorf("write verdict: %w", err)
	}
	if err := WriteSignaturesFile(options.RunDir); err != nil {
		fmt.Fprintf(run.streams.Err, "signatures: %v\n", err)
	}
	result.Summary = summary
	writeSummary(run.streams.Out, result, options.Agent)
	return result, nil
}

// writeSummary prints summary.txt. In agent mode a key=value line leads it,
// so a caller parses the verdict before reading the text.
func writeSummary(stdout io.Writer, result Result, agent bool) {
	if agent {
		fmt.Fprintf(stdout, "rows=%d findings=%d reports=%s\n", len(result.Rows), result.Findings, result.ReportDir)
	}
	fmt.Fprint(stdout, result.Summary)
	if !agent {
		fmt.Fprintf(stdout, "reports: %s/<edition>/report.html\n", result.ReportDir)
	}
}

// heldPorts reports which of the planned ports something already holds.
// Booting into an occupied port produces a stack that answers with someone
// else's application, which reads as a wholesale rewrite of every screen.
func heldPorts(ports []int, listening func(int) bool) []int {
	var held []int
	for _, port := range ports {
		if port > 0 && listening(port) {
			held = append(held, port)
		}
	}
	return held
}

func renderPorts(ports []int) string {
	rendered := make([]string, 0, len(ports))
	for _, port := range ports {
		rendered = append(rendered, strconv.Itoa(port))
	}
	return strings.Join(rendered, ", ")
}

func flowIDs(config *Config) []string {
	ids := make([]string, 0, len(config.Flows))
	for _, flow := range config.Flows {
		ids = append(ids, flow.ID)
	}
	return ids
}

func writePlan(stdout io.Writer, plan Plan, routesOnly bool) {
	fmt.Fprintf(stdout, "visual diff plan (dry run — nothing started)\n")
	fmt.Fprintf(stdout, "  run dir   %s\n", plan.RunDir)
	fmt.Fprintf(stdout, "  viewport  %s\n", plan.Viewport)
	for _, stack := range []*Stack{&plan.Base, &plan.Candidate} {
		if plan.UseHaven {
			fmt.Fprintf(stdout, "  %-9s %s - haven stack %s\n", stack.Name, stack.Ref, stack.HavenSlug)
			continue
		}
		fmt.Fprintf(stdout, "  %-9s %s — ui :%d, api :%d, worker :%d, redis db %s\n",
			stack.Name, stack.Ref, stack.Ports.UI, stack.Ports.API, stack.Ports.Worker, stack.RedisDBIndex)
	}
	fmt.Fprintf(stdout, "  routes    %d\n", plan.RouteCount)
	if routesOnly {
		fmt.Fprintf(stdout, "  flows     none (-routes-only)\n")
		return
	}
	fmt.Fprintf(stdout, "  flows     %d: %s\n", len(plan.FlowIDs), strings.Join(plan.FlowIDs, ", "))
}

// executor runs the per-stack shell steps from the repository root.
type executor struct {
	run    runner
	root   string
	stderr io.Writer
}

// WorktreeAddCommand builds the detached worktree checkout for one ref.
func WorktreeAddCommand(dir, ref string) commandSpec {
	return commandSpec{name: "git", args: []string{"worktree", "add", "--detach", dir, ref}}
}

func (steps *executor) addWorktree(ctx context.Context, stack Stack) error {
	fmt.Fprintf(steps.stderr, "%s: git worktree add --detach %s %s\n", stack.Name, stack.Dir, stack.Ref)
	spec := WorktreeAddCommand(stack.Dir, stack.Ref)
	spec.dir = steps.root
	if err := steps.run(ctx, spec, steps.stderr); err != nil {
		return fmt.Errorf("worktree add %s: %w", stack.Ref, err)
	}
	return nil
}

// PrepareCommands are the two steps a fresh worktree needs before it can
// boot: an install that prefers the store (the base ref's lockfile can pin a
// version the candidate's install never fetched, so the network stays
// available for those) and the generated files, Prisma client, evaluator
// types, SDK build, without which the stack does not start at all.
func PrepareCommands() []commandSpec {
	return []commandSpec{
		{name: "pnpm", args: []string{"install", "--prefer-offline"}},
		{name: "pnpm", args: []string{"run", "start:prepare:files"}},
	}
}

func (steps *executor) prepare(ctx context.Context, stack Stack) error {
	for _, spec := range PrepareCommands() {
		spec.dir = stack.Dir
		fmt.Fprintf(steps.stderr, "%s: %s %s\n", stack.Name, spec.name, strings.Join(spec.args, " "))
		if err := steps.run(ctx, spec, steps.stderr); err != nil {
			return fmt.Errorf("prepare %s (%s): %w", stack.Name, strings.Join(spec.args, " "), err)
		}
	}
	return nil
}

// StartStack spawns one stack's lanes and returns the function that stops
// them. Each lane gets its own process group so teardown can take the whole
// group down; killing the pnpm wrapper alone orphans the server it spawned.
func StartStack(ctx context.Context, stack Stack, logDir string) (func(), error) {
	var commands []*exec.Cmd
	stop := func() {
		for _, command := range commands {
			if command.Process != nil {
				_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
			}
		}
	}
	for _, argv := range stack.StartCommands() {
		command, err := startLane(ctx, stack, lane{argv: argv, logDir: logDir})
		if err != nil {
			return stop, err
		}
		commands = append(commands, command)
	}
	return stop, nil
}

// lane is one process of a stack: the pnpm script and where its log goes.
type lane struct {
	argv   []string
	logDir string
}

func startLane(ctx context.Context, stack Stack, one lane) (*exec.Cmd, error) {
	argv := one.argv
	logPath := filepath.Join(one.logDir, LaneLogName(stack.Name, argv[0]))
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600) // #nosec G304 -- path built from the run dir and the stack's own lane name.
	if err != nil {
		return nil, err
	}
	// #nosec G204 -- the executable is the constant "pnpm" and the args come
	// from Stack.StartCommands, which returns package-level literals.
	command := exec.CommandContext(ctx, "pnpm", argv...)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Dir = stack.Dir
	command.Env = stack.Env(os.Environ())
	command.Stdout = logFile
	command.Stderr = logFile
	if err := command.Start(); err != nil {
		_ = logFile.Close()
		return nil, fmt.Errorf("start %s %s: %w", stack.Name, argv[0], err)
	}
	return command, nil
}

// LaneLogName is one lane's log file, its script's colon made a dash: an
// uploaded CI artifact refuses a file name with a colon in it.
func LaneLogName(stack, script string) string {
	return stack + "-" + strings.ReplaceAll(script, ":", "-") + ".log"
}

// RunnerPackage is the workspace package that drives Playwright.
const RunnerPackage = "@langwatch/visual-diff-runner"

// CaptureOptions is where the runner is invoked from and where its progress
// goes.
type CaptureOptions struct {
	Root   string
	Stderr io.Writer
	// OnCapture and OnDiff, when set, are called the instant the runner
	// reports each capture or diff - streamed off its stdout as the
	// subprocess produces the line, not batched until it exits. Either may
	// be nil. This is what lets a caller write a findings.jsonl line per
	// comparison while the run is still going (see findings_stream.go).
	OnCapture func(Capture)
	OnDiff    func(Diff)
}

// RunRunner writes the plan to a file, runs the Node capture package over it
// and streams its JSON lines as they arrive. The plan goes to a file because
// the flow list is the whole configuration and a command line is the wrong
// place for it. Reading the subprocess's stdout live (a pipe, not the whole
// output buffered until the process exits) is what makes OnCapture/OnDiff a
// real live callback rather than one that only fires once capture is over.
func RunRunner(ctx context.Context, plan RunnerPlan, options CaptureOptions) (RunnerStream, error) {
	planPath := filepath.Join(plan.OutDir, "plan.json")
	if err := os.MkdirAll(plan.OutDir, 0o750); err != nil {
		return RunnerStream{}, err
	}
	encoded, err := json.MarshalIndent(plan, "", " ")
	if err != nil {
		return RunnerStream{}, err
	}
	if err := os.WriteFile(planPath, encoded, 0o600); err != nil {
		return RunnerStream{}, err
	}
	// #nosec G204 -- constant executable and constant args but for the plan
	// path, which this function just wrote inside the run directory.
	command := exec.CommandContext(ctx, "pnpm", "--silent", "--filter", RunnerPackage, "capture", "--plan", planPath)
	command.Dir = options.Root
	command.Stderr = options.Stderr
	stdout, err := command.StdoutPipe()
	if err != nil {
		return RunnerStream{}, err
	}
	if err := command.Start(); err != nil {
		return RunnerStream{}, err
	}
	stream, parseErr := ParseRunnerStreamLive(stdout, options.OnCapture, options.OnDiff)
	runErr := command.Wait()
	if parseErr != nil {
		return stream, parseErr
	}
	if runErr != nil {
		return stream, fmt.Errorf("runner: %w", runErr)
	}
	return stream, nil
}

// RunnerPreflight launches and closes the runner's browser; its stderr names
// the install command when Playwright's browser is missing.
func RunnerPreflight(ctx context.Context, root string) error {
	// #nosec G204 -- constant executable and constant args.
	command := exec.CommandContext(ctx, "pnpm", "--silent", "--filter", RunnerPackage, "preflight")
	command.Dir = root
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("runner preflight: %w\n%s", err, output)
	}
	return nil
}

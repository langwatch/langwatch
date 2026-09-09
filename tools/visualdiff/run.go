package visualdiff

import (
	"bytes"
	"context"
	"encoding/json"
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
	Run           runner
	Start         func(ctx context.Context, stack Stack, logDir string) (func(), error)
	Wait          func(ctx context.Context, urls []string, timeout time.Duration) error
	Seed          func(ctx context.Context, request SeedRequest) (SeedResult, error)
	Capture       func(ctx context.Context, plan RunnerPlan, options CaptureOptions) (RunnerStream, error)
	Listening     func(port int) bool
	Layout        func(dir string) (Layout, error)
	Now           func() time.Time
	AllocateRedis func(ctx context.Context) (RedisAllocation, error)
}

// Request is everything Execute needs: what to run, what to render, and what
// to run it through.
type Request struct {
	Options Options
	Config  *Config
	Deps    Deps
}

// Result is what a finished run produced.
type Result struct {
	Rows      []Row
	Findings  int
	ReportDir string
	Plan      Plan
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
	if deps.Capture == nil {
		deps.Capture = RunRunner
	}
	if deps.Start == nil {
		deps.Start = StartStack
	}
	if deps.AllocateRedis == nil {
		deps.AllocateRedis = ResolveRedisAllocation
	}
}

func (options *Options) fill(now func() time.Time) {
	if options.BasePort == 0 {
		options.BasePort = DefaultBasePort
	}
	if options.BootTimeout == 0 {
		options.BootTimeout = 20 * time.Minute
	}
	if options.TraceCount == 0 {
		options.TraceCount = 6
	}
	if options.RunDir == "" {
		options.RunDir = filepath.Join(options.Root, ".visualdiff", now().Format("20060102-150405"))
	}
}

// Execute is the whole run. Teardown is deferred before the first worktree
// exists, so every exit path — a failed install, a stack that never answers,
// a capture that throws, a canceled context — still frees the ports and
// removes the worktrees.
func Execute(ctx context.Context, request Request, streams Streams) (Result, error) {
	request.Deps.fill()
	request.Options.fill(request.Deps.Now)
	options, config, deps := request.Options, request.Config, request.Deps

	base, candidate := PlanStacks(options.BasePort, Refs{Base: options.BaseRef, Candidate: options.CandidateRef}, options.RunDir)
	plan := Plan{
		Base: base, Candidate: candidate, Viewport: options.Viewport, RunDir: options.RunDir,
		RoutesOnly: options.RoutesOnly, RouteCount: len(config.Routes), FlowIDs: flowIDs(config),
	}
	if options.RoutesOnly {
		plan.FlowIDs = nil
	}
	result := Result{Plan: plan}

	if options.DryRun {
		writePlan(streams.Out, plan, options.RoutesOnly)
		return result, nil
	}
	if held := heldPorts(plan.AllPorts(), deps.Listening); len(held) > 0 {
		return result, fmt.Errorf("ports %s are already in use — another stack is up; pass -base-port to move both stacks",
			renderPorts(held))
	}

	// Allocated last, right before anything boots: a dry run never reaches
	// here, so it never opens a Redis connection or shells out to haven.
	redisAllocation, err := deps.AllocateRedis(ctx)
	if err != nil {
		return result, fmt.Errorf("redis allocation: %w", err)
	}
	plan.Base.RedisDBIndex = strconv.Itoa(redisAllocation.Base)
	plan.Candidate.RedisDBIndex = strconv.Itoa(redisAllocation.Candidate)
	result.Plan = plan
	fmt.Fprintf(streams.Err, "redis: base db %s, candidate db %s\n", plan.Base.RedisDBIndex, plan.Candidate.RedisDBIndex)

	run := &session{request: request, streams: streams, plan: plan}
	teardown := Teardown{Root: options.Root, Run: deps.Run, Listening: deps.Listening, Log: streams.Err, Keep: options.Keep}
	// Registered first, so it runs last: the lanes are stopped, and only then
	// are the ports checked and the worktrees removed.
	defer func() {
		if err := teardown.Do(context.WithoutCancel(ctx), plan.AllPorts(), run.created); err != nil {
			fmt.Fprintln(streams.Err, err)
		}
	}()
	defer run.stopAll()

	if err := run.bringUp(ctx); err != nil {
		return result, err
	}
	stream, err := run.capture(ctx)
	if err != nil {
		return result, err
	}
	return run.report(stream)
}

// session is one run in progress: the plan it decided, the worktrees it has
// created so far, and the lanes it has started.
type session struct {
	request Request
	streams Streams
	plan    Plan
	created []string
	stops   []func()
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
	stacks := []*Stack{&run.plan.Base, &run.plan.Candidate}
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

// capture seeds the run's fixtures and drives the runner over both stacks.
func (run *session) capture(ctx context.Context) (RunnerStream, error) {
	options, config, deps := run.request.Options, run.request.Config, run.request.Deps
	plan := run.plan
	seed := SeedRequest{APIURL: plan.Candidate.APIURL(), Identity: options.Identity, TraceCount: options.TraceCount}
	if _, err := deps.Seed(ctx, seed); err != nil {
		return RunnerStream{}, fmt.Errorf("seed: %w", err)
	}
	runnerPlan := RunnerPlan{
		Viewport: options.Viewport,
		Settle:   config.Settle,
		Sides: []RunnerSide{
			{Name: "base", BaseURL: plan.Base.URL()},
			{Name: "candidate", BaseURL: plan.Candidate.URL()},
		},
		OutDir:     filepath.Join(options.RunDir, "shots"),
		Slug:       options.Identity.Slug,
		Routes:     config.Routes,
		Credential: options.Identity,
	}
	if !options.RoutesOnly {
		runnerPlan.Flows = config.Flows
	}
	stream, err := deps.Capture(ctx, runnerPlan, CaptureOptions{Root: options.Root, Stderr: run.streams.Err})
	if err != nil {
		return stream, fmt.Errorf("capture: %w", err)
	}
	return stream, nil
}

// report classifies the captures and writes the three artifacts.
func (run *session) report(stream RunnerStream) (Result, error) {
	options, plan := run.request.Options, run.plan
	result := Result{Plan: plan}
	result.Rows = BuildRows(stream.Captures, stream.Diffs)
	result.Findings = CountFindings(result.Rows)
	result.ReportDir = filepath.Join(options.RunDir, "report")
	meta := ReportMeta{
		BaseRef: options.BaseRef, CandidateRef: options.CandidateRef,
		BaseURL: plan.Base.URL(), CandidateURL: plan.Candidate.URL(),
		Viewport: options.Viewport.String(), StartedAt: run.request.Deps.Now().Format(time.RFC3339),
	}
	if err := WriteReport(result.ReportDir, result.Rows, meta); err != nil {
		return result, fmt.Errorf("write report: %w", err)
	}
	writeSummary(run.streams.Out, result, options.Agent)
	return result, nil
}

// writeSummary is the one line stdout carries. In agent mode it is key=value
// pairs, so a caller parses the result instead of a sentence.
func writeSummary(stdout io.Writer, result Result, agent bool) {
	if agent {
		fmt.Fprintf(stdout, "rows=%d findings=%d report=%s findings_json=%s\n",
			len(result.Rows), result.Findings,
			filepath.Join(result.ReportDir, "report.html"), filepath.Join(result.ReportDir, "findings.json"))
		return
	}
	fmt.Fprintf(stdout, "%d rows, %d findings — %s\n", len(result.Rows), result.Findings,
		filepath.Join(result.ReportDir, "report.html"))
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
	for _, stack := range []Stack{plan.Base, plan.Candidate} {
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
// boot: an offline install (every version this run compares is already in the
// store, so the network is not on the critical path) and the generated files
// — Prisma client, evaluator types, SDK build — without which the stack does
// not start at all.
func PrepareCommands() []commandSpec {
	return []commandSpec{
		{name: "pnpm", args: []string{"install", "--offline"}},
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
	logPath := filepath.Join(one.logDir, stack.Name+"-"+argv[0]+".log")
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

// RunnerPackage is the workspace package that drives Playwright.
const RunnerPackage = "@langwatch/visual-diff-runner"

// CaptureOptions is where the runner is invoked from and where its progress
// goes.
type CaptureOptions struct {
	Root   string
	Stderr io.Writer
}

// RunRunner writes the plan to a file, runs the Node capture package over it
// and parses its JSON lines. The plan goes to a file because the flow list is
// the whole configuration and a command line is the wrong place for it.
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
	output := &bytes.Buffer{}
	// #nosec G204 -- constant executable and constant args but for the plan
	// path, which this function just wrote inside the run directory.
	command := exec.CommandContext(ctx, "pnpm", "--filter", RunnerPackage, "capture", "--plan", planPath)
	command.Dir = options.Root
	command.Stdout = output
	command.Stderr = options.Stderr
	runErr := command.Run()
	stream, parseErr := ParseRunnerStream(bytes.NewReader(output.Bytes()))
	if parseErr != nil {
		return stream, parseErr
	}
	if runErr != nil {
		return stream, fmt.Errorf("runner: %w", runErr)
	}
	return stream, nil
}

package visualdiff

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"maps"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// LoopCandidateURL is the fix loop's candidate stack, which `check -url` can name.
const LoopCandidateURL = "https://app.visualdiff-loop-candidate.langwatch.localhost"

// checkFlags is one parsed `visualdiff check` command line.
type checkFlags struct {
	root, url, only, skip string
	pages, maxErrors      int
	batchSize             int
	all, mark, down       bool
	devUI, shared, fast   bool
	// stack is the haven stack checked (-url aside); baseURL a live main to compare
	// with instead of the baseline; adoptOnly refuses to boot (diffsuite owns the stacks).
	stack, baseURL    string
	routes, adoptOnly bool
}

// checkCommand is `visualdiff check`: every flow not yet done (less -skip) against ONE
// app, several at a time: by default check's own stack, booted from the working tree
// and seeded. It answers pass or fail per flow, and whether each looks like main's baseline.
func checkCommand(ctx context.Context, args []string, streams Streams) int {
	began := time.Now()
	streams = Streams{Out: clockLines(streams.Out), Err: clockLines(streams.Err)}
	parsed, err := parseCheckFlags(args, streams.Err)
	if err != nil {
		return ExitOperational
	}
	if parsed.down {
		if err := downCheckStack(ctx, parsed.root, streams.Err); err != nil {
			fmt.Fprintln(streams.Err, "visualdiff check:", err)
			return ExitOperational
		}
		return ExitClean
	}
	config, done, err := checkConfig(parsed)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff check:", err)
		return ExitOperational
	}
	if err := RunnerPreflight(ctx, parsed.root); err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", diffkit.SetupFailed(err))
		return ExitOperational
	}
	times := checkTimes{}
	side, err := checkSide(ctx, parsed, &times, streams.Err)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", diffkit.SetupFailed(err))
		return ExitOperational
	}
	setupStarted := time.Now()
	setups, warnings := runFlowSetups(ctx, setupRequest{apiURL: side.BaseURL, key: DefaultProjectKey, fixtures: side.Fixtures, flows: config.Flows})
	for _, warning := range warnings {
		fmt.Fprintln(streams.Err, "check:", warning)
	}
	side.Fixtures = mergeFixtures(side.Fixtures, setups)
	times.seed += time.Since(setupStarted)
	times.seedParts = append(times.seedParts, SeedTiming{Part: "setups", Took: time.Since(setupStarted)})
	if parsed.pages <= 0 {
		parsed.pages = CheckPages(runtime.NumCPU(), readFreeMemory(ctx))
	}
	plan := checkPlan(parsed, side, config)
	// A fast check's lean pixels would differ from main's baseline everywhere, so it compares none.
	baseline, held := "", map[string]bool(nil)
	if parsed.baseURL != "" {
		base, err := liveBase(ctx, parsed.baseURL, config.Flows, streams.Err)
		if err != nil {
			fmt.Fprintln(streams.Err, "visualdiff:", diffkit.SetupFailed(err))
			return ExitOperational
		}
		plan.Sides, held = append([]RunnerSide{base}, plan.Sides...), map[string]bool{}
		for _, id := range flowIDs(config) {
			held[id] = true
		}
		fmt.Fprintf(streams.Err, "check: screenshots compared with main at %s\n", parsed.baseURL)
	} else if !parsed.fast {
		baseline, held = checkBaseline(parsed.root, config.Flows)
	}
	if baseline != "" {
		plan.Sides = append([]RunnerSide{{Name: "base", Replay: filepath.Join(baseline, BaselineCaptures)}}, plan.Sides...)
		fmt.Fprintf(streams.Err, "check: screenshots compared with %s (%d of %d flows)\n", baseline, len(held), len(config.Flows))
	}
	fmt.Fprintf(streams.Err, "check: %d flows against %s, %d at a time\n", len(plan.Flows), side.BaseURL, plan.Concurrency.Flows)
	results := newFlowResults()
	started := time.Now()
	progress := &checkProgress{results: results, total: len(plan.Flows), started: started, out: streams.Err}
	resetBatches(plan.OutDir)
	batches := newBatcher(batcherInputs{OutDir: plan.OutDir, Size: parsed.batchSize, Plan: plan, Out: streams.Out})
	stream, runErr := RunRunner(ctx, plan, batches.wrap(CaptureOptions{Root: parsed.root, Stderr: streams.Err, MaxConsecutiveErrors: parsed.maxErrors, OnCapture: func(capture Capture) {
		if line := results.add(capture); line != "" {
			fmt.Fprintln(streams.Err, line)
		}
	}, OnPhase: progress.phase}))
	if err := batches.close(); err != nil {
		fmt.Fprintln(streams.Err, "visualdiff: batches:", err)
	}
	fmt.Fprintf(streams.Err, "check: phase flows %s, compare and close %s\n", progress.flowsTook().Round(time.Second), progress.windDown().Round(time.Second))
	if failure := runnerFailure(stream, runErr); failure != "" {
		fmt.Fprintln(streams.Err, "visualdiff:", diffkit.SetupFailed(errors.New(failure)))
		_ = os.WriteFile(filepath.Join(plan.OutDir, "check-report.md"), []byte("# visualdiff check\n\nRUNNER FAILED: "+failure+"\n"), 0o600)
		return ExitOperational
	}
	outcome := results.outcome(checkOutcomeInputs{flows: config.Flows, done: done, diffs: stream.Diffs, held: held, took: time.Since(started)})
	if len(plan.Routes) > 0 {
		outcome = withRoutes(outcome, plan, stream)
	}
	outcome.text += timingBlock(times, stream.Phases, time.Since(began))
	fmt.Fprint(streams.Out, outcome.text)
	if err := os.WriteFile(filepath.Join(plan.OutDir, "check-report.md"), []byte("# visualdiff check\n\n```\n"+outcome.text+"```\n"), 0o600); err != nil {
		fmt.Fprintln(streams.Err, "visualdiff check:", err)
	}
	if parsed.mark {
		markPassed(parsed.root, outcome.passed, BuildRows(stream.Captures, stream.Diffs), streams.Out)
	}
	var stopped *diffkit.Stopped
	if errors.As(runErr, &stopped) {
		fmt.Fprintln(streams.Err, "visualdiff:", stopped)
		return diffkit.ExitStopped
	}
	if runErr != nil {
		fmt.Fprintln(streams.Err, "visualdiff check:", runErr)
		return ExitOperational
	}
	if outcome.failed > 0 {
		return ExitFindings
	}
	return ExitClean
}

// runnerFailure names a runner that drove no candidate page, so a dead browser
// reads as one failure rather than every flow UNPROVEN.
func runnerFailure(stream RunnerStream, runErr error) string {
	for _, capture := range stream.Captures {
		if capture.Side != "base" {
			return ""
		}
	}
	if runErr != nil {
		return "runner drove no page: " + runErr.Error()
	}
	return "runner drove no page and reported no error"
}

func parseCheckFlags(args []string, stderr io.Writer) (checkFlags, error) {
	flags := flag.NewFlagSet("check", flag.ContinueOnError)
	flags.SetOutput(stderr)
	parsed := checkFlags{}
	flags.StringVar(&parsed.root, "root", ".", "repository root")
	flags.StringVar(&parsed.url, "url", "", "a running app to check instead of check's own stack (booted from the working tree)")
	flags.StringVar(&parsed.only, "only", "", "comma-separated flow ids to run (default: all not done)")
	flags.StringVar(&parsed.skip, "skip", "", "comma-separated flow ids to leave out")
	flags.IntVar(&parsed.pages, "pages", 0, "flows run at once (default up to 4: half the CPUs, one per GB free)")
	flags.IntVar(&parsed.maxErrors, "max-consecutive-errors", DefaultMaxConsecutiveErrors, "stop after this many captures in a row that are harness or stack errors (0 never stops)")
	flags.BoolVar(&parsed.all, "all", false, "run the flows the done ledger holds too (the final pass)")
	flags.BoolVar(&parsed.mark, "mark", false, "mark every flow that passes as done, so later checks skip it")
	flags.BoolVar(&parsed.down, "down", false, "destroy check's own stack and forget its seed")
	flags.BoolVar(&parsed.devUI, "dev-ui", false, "serve pages from the stack's Vite dev server instead of a production build")
	flags.BoolVar(&parsed.fast, "fast", false, "render on a lean Chromium: quicker, but not the pixels a pull request shows")
	flags.BoolVar(&parsed.shared, "shared", false, "lanes share the stack: boot, seed and ui build under a lock, never restart it")
	flags.StringVar(&parsed.stack, "stack", CheckSlug, "the haven stack to check; diffsuite's branch stack under diffsuite")
	flags.StringVar(&parsed.baseURL, "base-url", "", "a running main to compare with instead of the pinned baseline; diffsuite's main stack under diffsuite")
	flags.IntVar(&parsed.batchSize, "batch-size", DefaultBatchSize, "seal a review batch every this many routes or flows (0 never does)")
	flags.BoolVar(&parsed.routes, "routes", false, "capture every route too, and write report/ beside check-report.md")
	if err := flags.Parse(args); err != nil {
		return parsed, err
	}
	fromSuite(&parsed, flags)
	root, err := filepath.Abs(parsed.root)
	if err != nil {
		fmt.Fprintln(stderr, "visualdiff:", err)
	}
	parsed.root = root
	return parsed, err
}

// checkConfig is visualdiff.yaml's flows narrowed by -only, less -skip and, without
// -all, less the flows the done ledger holds, which it returns.
func checkConfig(parsed checkFlags) (*Config, []string, error) {
	config, err := LoadConfig(filepath.Join(parsed.root, ConfigFile))
	if err != nil {
		return nil, nil, err
	}
	skipped := splitList(parsed.skip)
	wanted := splitList(parsed.only)
	var ids []string
	for index := range config.Flows {
		id := config.Flows[index].ID
		if (len(wanted) == 0 || slices.Contains(wanted, id)) && !slices.Contains(skipped, id) {
			ids = append(ids, id)
		}
	}
	routes := config.Routes
	selected, err := config.Select([]string{}, ids)
	if err == nil {
		selected.Routes = nil
		if parsed.routes {
			selected.Routes = routes
		}
	}
	if err != nil || parsed.all {
		return selected, nil, err
	}
	ledger, err := LoadDoneLedger(parsed.root)
	if err != nil {
		return nil, nil, err
	}
	scoped, keys := ledger.Scope(selected, EditionEnterprise)
	var done []string
	for _, key := range keys {
		done = append(done, ledger.find(key).Section)
	}
	return scoped, done, nil
}

// checkSide is the app under check: check's own stack, or -url as given, unseeded.
func checkSide(ctx context.Context, parsed checkFlags, times *checkTimes, stderr io.Writer) (RunnerSide, error) {
	if parsed.url == "" {
		return checkStack(ctx, checkStackRequest{root: parsed.root, slug: parsed.stack, devUI: parsed.devUI, shared: parsed.shared, adoptOnly: parsed.adoptOnly, stderr: stderr}, times)
	}
	app := Stack{HavenURL: parsed.url}
	return RunnerSide{Name: "candidate", BaseURL: app.URL(), MailURL: app.MailURL(), Fixtures: map[string]string{}}, nil
}

// fromSuite points check at the stacks diffsuite handed it, when no flag named one:
// the branch stack, adopted and never booted or restarted, and main's, live.
func fromSuite(parsed *checkFlags, flags *flag.FlagSet) {
	branch, ok := diffkit.SuiteStack(diffkit.SuiteBranch)
	if !ok || parsed.url != "" {
		return
	}
	if !isFlagSet(flags, "stack") {
		parsed.stack = branch.Slug
	}
	parsed.adoptOnly, parsed.shared = true, true
	if main, ok := diffkit.SuiteStack(diffkit.SuiteMain); ok && parsed.baseURL == "" {
		parsed.baseURL = main.AppURL
	}
}

// liveBase seeds a running main as run seeds its base, and answers it as the runner's base side.
func liveBase(ctx context.Context, url string, flows []Flow, stderr io.Writer) (RunnerSide, error) {
	stack := Stack{HavenURL: url}
	seeded, err := Seed(ctx, SeedRequest{APIURL: stack.APIURL(), Identity: SeedIdentity{}.withSeededDefaults(), TraceCount: 6})
	if err != nil {
		return RunnerSide{}, fmt.Errorf("seed main: %w", err)
	}
	setups, warnings := runFlowSetups(ctx, setupRequest{apiURL: stack.APIURL(), key: DefaultProjectKey, fixtures: seeded.Fixtures, flows: flows})
	for _, warning := range append(seeded.Warnings, warnings...) {
		fmt.Fprintln(stderr, "check: main:", warning)
	}
	return RunnerSide{Name: "base", BaseURL: stack.URL(), MailURL: stack.MailURL(), Fixtures: mergeFixtures(seeded.Fixtures, setups)}, nil
}

// withRoutes adds a line per route that fails or differs from main, writes the full
// report under report/enterprise/ (what `visualdiff publish` reads), and counts those routes as failures.
func withRoutes(outcome checkOutcome, plan RunnerPlan, stream RunnerStream) checkOutcome {
	rows := BuildRows(stream.Captures, stream.Diffs)
	var out strings.Builder
	total, failed, unmatched := 0, 0, 0
	for index := range rows {
		row := rows[index]
		if row.Kind != "route" {
			continue
		}
		total++
		switch {
		case row.Base == nil && (row.Candidate == nil || row.Candidate.Error == ""):
			unmatched++
		case row.Finding():
			failed++
			fmt.Fprintf(&out, "ROUTE    %s · %s · %s\n", row.Key, row.Class, row.Why)
		}
	}
	fmt.Fprintf(&out, "%d/%d routes without a finding (%d with nothing of main's to compare)\n", total-failed, total, unmatched)
	report := filepath.Join(plan.OutDir, "report", string(EditionEnterprise))
	if err := WriteReport(report, rows, ReportMeta{CandidateURL: plan.Sides[len(plan.Sides)-1].BaseURL, StartedAt: time.Now().UTC().Format(time.RFC3339)}); err != nil {
		fmt.Fprintf(&out, "report: %v\n", err)
	}
	outcome.text += out.String()
	outcome.failed += failed
	return outcome
}

// checkPlan is a runner plan whose one live side is the app under check.
func checkPlan(parsed checkFlags, side RunnerSide, config *Config) RunnerPlan {
	identity := SeedIdentity{}.withSeededDefaults()
	return RunnerPlan{
		Viewport:    configuredViewport(config, Viewport{Width: 1440, Height: 900}),
		Settle:      config.Settle,
		Sides:       []RunnerSide{side},
		OutDir:      CheckDir(parsed.root),
		Slug:        identity.Slug,
		Routes:      append([]string{}, config.Routes...),
		Flows:       config.Flows,
		Credential:  identity,
		FrozenTime:  time.Now().UnixMilli(),
		Fixtures:    config.Fixtures,
		Concurrency: Concurrency{Routes: parsed.pages, Flows: parsed.pages},
		Edition:     EditionEnterprise,
		Check:       true,
		Fast:        parsed.fast,
	}
}

// clockLines opens every line with the wall-clock time, [15:04:05].
func clockLines(out io.Writer) io.Writer {
	return diffkit.ClockLines(out)
}

// checkProgress prints a line as each flow ends: done, the tally, elapsed and what is left.
// flowsFrom is when the route pass ended; the time left is paced from there, not the start.
type checkProgress struct {
	mutex       sync.Mutex
	results     *flowResults
	total       int
	done        int
	doneAtFlows int
	tally       map[string]int
	started     time.Time
	flowsFrom   time.Time
	lastFlow    time.Time
	out         io.Writer
}

func (progress *checkProgress) phase(phase RunnerPhase) {
	if phase.Side != "candidate" {
		return
	}
	progress.mutex.Lock()
	defer progress.mutex.Unlock()
	if phase.Name == "recapture" {
		progress.flowsFrom, progress.doneAtFlows = time.Now(), progress.done
		return
	}
	id, isFlow := strings.CutPrefix(phase.Name, "flow ")
	if !isFlow {
		return
	}
	if progress.tally == nil {
		progress.tally = map[string]int{}
	}
	progress.done++
	progress.tally[progress.results.verdict(id)]++
	progress.lastFlow = time.Now()
	fmt.Fprintf(progress.out, "%d/%d flows · %d pass %d fail %d unproven · %s elapsed · ~%s left\n",
		progress.done, progress.total, progress.tally["pass"], progress.tally["fail"], progress.tally["unproven"],
		time.Since(progress.started).Round(time.Second), progress.left(time.Now()).Round(time.Second))
}

// left is the flows still to run at the pace of those done since flowsFrom (the start without one).
func (progress *checkProgress) left(now time.Time) time.Duration {
	from, done := progress.flowsFrom, progress.done-progress.doneAtFlows
	if from.IsZero() {
		from, done = progress.started, progress.done
	}
	if done <= 0 {
		return 0
	}
	return now.Sub(from) / time.Duration(done) * time.Duration(progress.total-progress.done)
}

// flowsTook is from the first page to the last flow's end.
func (progress *checkProgress) flowsTook() time.Duration {
	if progress.lastFlow.IsZero() {
		return time.Since(progress.started)
	}
	return progress.lastFlow.Sub(progress.started)
}

// windDown is from the last flow's end to the runner's exit: comparing and closing.
func (progress *checkProgress) windDown() time.Duration {
	if progress.lastFlow.IsZero() {
		return 0
	}
	return time.Since(progress.lastFlow)
}

func mergeFixtures(fixtures, more map[string]string) map[string]string {
	merged := map[string]string{}
	maps.Copy(merged, fixtures)
	maps.Copy(merged, more)
	return merged
}

// slowestFlows is how many of the slowest flows the timing block names.
const slowestFlows = 5

// timingBlock says where a check's time went: boot, build, seed, sign-in, the flows
// and the slowest of them.
func timingBlock(times checkTimes, phases []RunnerPhase, total time.Duration) string {
	var out strings.Builder
	signIn := time.Duration(0)
	var flows []RunnerPhase
	for _, phase := range phases {
		switch {
		case phase.Side != "candidate":
		case phase.Name == "sign-in":
			signIn = time.Duration(phase.Millis) * time.Millisecond
		case strings.HasPrefix(phase.Name, "flow "):
			flows = append(flows, phase)
		}
	}
	round := func(duration time.Duration) time.Duration { return duration.Round(100 * time.Millisecond) }
	fmt.Fprintf(&out, "timing: boot %s · ui build %s · seed+setup %s · sign-in %s · total %s\n",
		round(times.boot), round(times.build), round(times.seed), round(signIn), round(total))
	for _, part := range times.seedParts {
		fmt.Fprintf(&out, "  seed: %s %s\n", part.Part, round(part.Took))
	}
	slices.SortFunc(flows, func(a, b RunnerPhase) int { return int(b.Millis - a.Millis) })
	for _, phase := range flows[:min(slowestFlows, len(flows))] {
		fmt.Fprintf(&out, "  slow: %s %s\n", strings.TrimPrefix(phase.Name, "flow "), round(time.Duration(phase.Millis)*time.Millisecond))
	}
	return out.String()
}

// checkBaseline is the pinned main's cached enterprise baseline holding the most of
// these flows with the same steps, and those flows. Main is never booted for it.
func checkBaseline(root string, flows []Flow) (string, map[string]bool) {
	pin := ReadMainPin(root)
	if len(pin.Commit) < 12 {
		return "", nil
	}
	dirs, _ := filepath.Glob(filepath.Join(root, ".visualdiff", BaselinesDir, pin.Commit[:12]+"-"+string(EditionEnterprise)+"-*"))
	wanted := flowHashes(flows)
	best, bestHeld, bestAt := "", map[string]bool{}, time.Time{}
	for _, dir := range dirs {
		if !(Baseline{Dir: dir}).Present() {
			continue
		}
		meta := readBaselineMeta(dir)
		held := map[string]bool{}
		for id, steps := range wanted {
			if meta.Flows[id] == steps {
				held[id] = true
			}
		}
		if len(held) > len(bestHeld) || (len(held) == len(bestHeld) && len(held) > 0 && meta.CreatedAt.After(bestAt)) {
			best, bestHeld, bestAt = dir, held, meta.CreatedAt
		}
	}
	return best, bestHeld
}

// flowResults keeps each flow's first failure and its held expects as captures stream in.
type flowResults struct {
	mutex    sync.Mutex
	failures map[string]string
	held     map[string][]string
}

func newFlowResults() *flowResults {
	return &flowResults{failures: map[string]string{}, held: map[string][]string{}}
}

// add records one capture of the app under check and returns a live line for a flow's first failure.
func (results *flowResults) add(capture Capture) string {
	if capture.Kind != "flow" || capture.Side != "candidate" {
		return ""
	}
	results.mutex.Lock()
	defer results.mutex.Unlock()
	if capture.Error != "" {
		if _, seen := results.failures[capture.Key]; !seen {
			results.failures[capture.Key] = fmt.Sprintf("step %d %s: %s", capture.Index, capture.Label, head(capture.Error))
			return "FAIL " + capture.Key + " · " + results.failures[capture.Key]
		}
		return ""
	}
	if capture.Expect != "" {
		results.held[capture.Key] = append(results.held[capture.Key], capture.Expect)
	}
	return ""
}

// verdict is one flow's answer so far: pass, fail or unproven.
func (results *flowResults) verdict(id string) string {
	results.mutex.Lock()
	defer results.mutex.Unlock()
	switch {
	case results.failures[id] != "":
		return "fail"
	case len(results.held[id]) == 0:
		return "unproven"
	default:
		return "pass"
	}
}

// checkOutcomeInputs are what the per-flow answer is read from.
type checkOutcomeInputs struct {
	flows []Flow
	done  []string
	diffs []Diff
	held  map[string]bool
	took  time.Duration
}

// checkOutcome is the printed answer, the flows that passed, and how many did not.
type checkOutcome struct {
	text   string
	passed map[string][]string
	failed int
}

// outcome is one line per flow: pass or fail, and how its screens compare with main.
func (results *flowResults) outcome(inputs checkOutcomeInputs) checkOutcome {
	var out strings.Builder
	outcome := checkOutcome{passed: map[string][]string{}}
	for _, id := range inputs.done {
		fmt.Fprintf(&out, "DONE     %s (skipped; -all runs it)\n", id)
	}
	for index := range inputs.flows {
		id := inputs.flows[index].ID
		looks := looksLikeMain(id, inputs.held[id], inputs.diffs)
		switch failure, held := results.failures[id], results.held[id]; {
		case failure != "":
			outcome.failed++
			fmt.Fprintf(&out, "FAIL     %s · %s · %s\n", id, failure, looks)
		case len(held) == 0:
			outcome.failed++
			fmt.Fprintf(&out, "UNPROVEN %s · no expect held · %s\n", id, looks)
		default:
			outcome.passed[id] = held
			fmt.Fprintf(&out, "PASS     %s (%d expects) · %s\n", id, len(held), looks)
		}
	}
	fmt.Fprintf(&out, "%d/%d flows passed in %s\n", len(inputs.flows)-outcome.failed, len(inputs.flows), inputs.took.Round(time.Second))
	outcome.text = out.String()
	return outcome
}

// looksLikeMain compares a flow's screens with main's baseline by its worst step.
func looksLikeMain(id string, held bool, diffs []Diff) string {
	worst, diffed := 0.0, false
	for _, diff := range diffs {
		if diff.Kind == "flow" && diff.Key == id {
			worst, diffed = max(worst, diff.Ratio), true
		}
	}
	switch {
	case !held || !diffed:
		return "no baseline"
	case worst < NoiseRatio:
		return "looks like main"
	default:
		return fmt.Sprintf("differs from main (%.1f%%)", worst*100)
	}
}

// markPassed writes a done-ledger entry for each flow that passed, its screens as proof.
func markPassed(root string, passed map[string][]string, rows []Row, out io.Writer) {
	now := time.Now().UTC()
	for id, proof := range passed {
		flowRows := sectionRows(rows, "flow", id)
		classes := rowClasses(flowRows)
		entry := DoneEntry{
			Key: DoneKey(EditionEnterprise, "flow", id), Edition: EditionEnterprise, Kind: "flow", Section: id,
			RunID: "check", Date: now, Note: "passed visualdiff check", Classes: classes,
			Forced: len(failingClasses(classes)) > 0, Proof: proof,
		}
		if err := writeDoneEntry(filepath.Join(doneRoot(root), filepath.FromSlash(entry.Key)), entry, flowRows); err != nil {
			fmt.Fprintf(out, "mark %s: %v\n", id, err)
			continue
		}
		fmt.Fprintf(out, "marked done: %s\n", id)
	}
}

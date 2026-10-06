package diffsuite

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	keepIterations = 2
	// minGap is the shortest start-to-start time, so a tool that fails at once cannot spin.
	minGap    = 30 * time.Second
	downGrace = 2 * time.Minute
	loadPoll  = time.Minute
	idLimit   = 20
)

// clock is time as the loops see it; tests replace it with one that never waits.
type clock struct {
	now   func() time.Time
	sleep func(ctx context.Context, d time.Duration) error
}

var realClock = clock{now: time.Now, sleep: func(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}}

func (c clock) sleepUntil(ctx context.Context, at time.Time) error {
	if d := at.Sub(c.now()); d > 0 {
		return c.sleep(ctx, d)
	}
	return ctx.Err()
}

// outcome is what one tool iteration showed. Stopped is set when the iteration
// is not a fair baseline: the tool stopped, was cancelled, or the stack went away.
type outcome struct {
	Exit    int    `json:"exit"`
	Stopped string `json:"stopped,omitempty"`
	Pass    int    `json:"pass"`
	Fail    int    `json:"fail"`
	Errors  int    `json:"errors"`
	// Latency counts latency-class fuzz findings, kept out of Fail, New and Fixed.
	Latency int      `json:"latency"`
	Failing []string `json:"failing"`
}

// summary is latest.json: the newest iteration of a tool, and how it differs from the one before.
type summary struct {
	outcome
	Tool       string    `json:"tool"`
	Iteration  int       `json:"iteration"`
	Commit     string    `json:"commit"`
	StartedAt  time.Time `json:"startedAt"`
	DurationMs int64     `json:"durationMs"`
	Dir        string    `json:"dir"`
	Baseline   int       `json:"baseline"`
	// BaselineFrom names the run directory a baseline came from when it is not an iteration.
	BaselineFrom string `json:"baselineFrom,omitempty"`
	// BaselineFail is the fail plus error count of the baseline.
	BaselineFail int      `json:"baselineFail"`
	New          []string `json:"new"`
	Fixed        []string `json:"fixed"`
}

// job is one tool's loop: every is zero for back to back, else the start-to-start period.
type job struct {
	name  string
	every time.Duration
}

// session holds what the loops need; the real ones are wired in suite.continuous.
type session struct {
	out     string
	clock   clock
	say     func(format string, args ...any)
	ready   func(ctx context.Context) error
	prepare func(ctx context.Context, name string) (string, error)
	load    func() float64
	loadMax float64
	run     func(ctx context.Context, name, dir string) outcome
}

// loopState is what one tool's loop carries between iterations.
type loopState struct {
	toolDir string
	n       int
	before  *summary
	began   time.Time
}

func (s *session) loop(ctx context.Context, j job) {
	toolDir := filepath.Join(s.out, j.name)
	state := &loopState{toolDir: toolDir, n: lastIteration(toolDir), before: s.baseline(toolDir, j.name)}
	for ctx.Err() == nil {
		if !s.pace(ctx, j, state.began) || !s.iterate(ctx, j, state) {
			return
		}
	}
}

// pace waits out the gap since the last start, then the load and the stack;
// false ends the loop.
func (s *session) pace(ctx context.Context, j job, began time.Time) bool {
	if !began.IsZero() && s.clock.sleepUntil(ctx, began.Add(max(j.every, minGap))) != nil {
		return false
	}
	return !(j.every > 0 && s.waitLoad(ctx, j.name) != nil || s.ready(ctx) != nil)
}

// iterate prepares and runs one iteration and records it; false ends the loop.
func (s *session) iterate(ctx context.Context, j job, state *loopState) bool {
	commit, err := s.prepare(ctx, j.name)
	if err != nil {
		s.say("[%s] BUILD FAILED: %v", j.name, err)
		state.began = s.clock.now()
		return true
	}
	state.n++
	dir := filepath.Join(state.toolDir, fmt.Sprintf("%04d", state.n))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.say("[%s] cannot create %s: %v", j.name, dir, err)
		return false
	}
	state.began = s.clock.now()
	result := s.run(ctx, j.name, dir)
	done := summarize(iteration{name: j.name, n: state.n, commit: commit, began: state.began, ended: s.clock.now(), dir: dir, result: result}, state.before)
	if result.Stopped == "" {
		state.before = &done
	}
	writeLatest(state.toolDir, done)
	prune(state.toolDir, keepIterations)
	s.report(done)
	return true
}

func (s *session) waitLoad(ctx context.Context, name string) error {
	for waiting := false; s.load() >= s.loadMax; waiting = true {
		if !waiting {
			s.say("[%s] WAITING for load below %.1f", name, s.loadMax)
		}
		if err := s.clock.sleep(ctx, loadPoll); err != nil {
			return err
		}
	}
	return ctx.Err()
}

// iteration is one finished run of a tool: which, when, where and what it showed.
type iteration struct {
	name         string
	n            int
	commit       string
	began, ended time.Time
	dir          string
	result       outcome
}

func summarize(run iteration, before *summary) summary {
	result := run.result
	done := summary{outcome: result, Tool: run.name, Iteration: run.n, Commit: run.commit, StartedAt: run.began,
		DurationMs: run.ended.Sub(run.began).Milliseconds(), Dir: run.dir, New: []string{}, Fixed: []string{}}
	if done.Failing == nil {
		done.Failing = []string{}
	}
	if before != nil && result.Stopped == "" {
		done.Baseline, done.BaselineFail = before.Iteration, before.Fail+before.Errors
		if before.Iteration == 0 {
			done.BaselineFrom = before.BaselineFrom
		}
		done.New, done.Fixed = delta(before.Failing, result.Failing)
	}
	return done
}

// delta answers the ids that failed now and not before, and the ones that failed before and not now.
func delta(before, now []string) (added, fixed []string) {
	added, fixed = []string{}, []string{}
	for _, id := range now {
		if !slices.Contains(before, id) {
			added = append(added, id)
		}
	}
	for _, id := range before {
		if !slices.Contains(now, id) {
			fixed = append(fixed, id)
		}
	}
	slices.Sort(added)
	slices.Sort(fixed)
	return added, fixed
}

func (s *session) report(done summary) {
	if done.Stopped != "" {
		s.say("[%s] #%d STOPPED (%s) at %s", done.Tool, done.Iteration, done.Stopped, done.Commit)
		return
	}
	change := "no earlier iteration to compare"
	if done.Baseline > 0 || done.BaselineFrom != "" {
		against := cmpOr(done.BaselineFrom, "#"+strconv.Itoa(done.Baseline))
		change = fmt.Sprintf("Δ %s fail vs %s", signed(done.Fail+done.Errors-done.BaselineFail), against)
	}
	errs := ""
	if done.Errors > 0 {
		errs = fmt.Sprintf(" %d error", done.Errors)
	}
	if done.Latency > 0 {
		errs += fmt.Sprintf(" %d latency", done.Latency)
	}
	s.say("[%s] #%d DONE %d pass %d fail%s (%s) at %s", done.Tool, done.Iteration, done.Pass, done.Fail, errs, change, done.Commit)
	for _, list := range []struct {
		label string
		ids   []string
	}{{"new", done.New}, {"fixed", done.Fixed}} {
		if len(list.ids) > 0 {
			every := done.Tool == "api" && list.label == "fixed"
			s.say("[%s] #%d %s (%d): %s", done.Tool, done.Iteration, list.label, len(list.ids), idList(list.ids, every))
		}
	}
}

func signed(n int) string {
	if n == 0 {
		return "0"
	}
	return fmt.Sprintf("%+d", n)
}

// idList joins ids, cut to idLimit unless every is set.
func idList(ids []string, every bool) string {
	if every || len(ids) <= idLimit {
		return strings.Join(ids, "; ")
	}
	return fmt.Sprintf("%s; +%d more in latest.json", strings.Join(ids[:idLimit], "; "), len(ids)-idLimit)
}

// iterations lists the numbered iteration directories of a tool, oldest first.
func iterations(toolDir string) []int {
	entries, _ := os.ReadDir(toolDir)
	var found []int
	for _, entry := range entries {
		if n, err := strconv.Atoi(entry.Name()); err == nil && entry.IsDir() {
			found = append(found, n)
		}
	}
	slices.Sort(found)
	return found
}

func lastIteration(toolDir string) int {
	found := iterations(toolDir)
	if len(found) == 0 {
		return 0
	}
	return found[len(found)-1]
}

// prune deletes all but the newest keep iteration directories.
func prune(toolDir string, keep int) {
	found := iterations(toolDir)
	for _, n := range found[:max(0, len(found)-keep)] {
		os.RemoveAll(filepath.Join(toolDir, fmt.Sprintf("%04d", n)))
	}
}

func readLatest(toolDir string) *summary {
	body, err := os.ReadFile(filepath.Join(toolDir, "latest.json")) // #nosec G304 -- the suite's own -out.
	var last summary
	if err != nil || json.Unmarshal(body, &last) != nil || last.Stopped != "" {
		return nil
	}
	return &last
}

// baseline is the summary a first iteration compares with: latest.json, else the newest
// finished iteration, else for api the newest apidiff run beside the suite's -out.
func (s *session) baseline(toolDir, name string) *summary {
	if last := readLatest(toolDir); last != nil {
		return last
	}
	for _, n := range slices.Backward(iterations(toolDir)) {
		var last summary
		body, err := os.ReadFile(filepath.Join(toolDir, fmt.Sprintf("%04d", n), "summary.json")) // #nosec G304 -- the suite's own -out.
		if err == nil && json.Unmarshal(body, &last) == nil && last.Stopped == "" {
			return &last
		}
	}
	if name != "api" {
		return nil
	}
	return apidiffBaseline(filepath.Dir(s.out))
}

// apidiffBaseline reads the newest <runs>/*/out/apidiff/scenarios.jsonl as a summary.
func apidiffBaseline(runs string) *summary {
	paths, _ := filepath.Glob(filepath.Join(runs, "*", "out", "apidiff", "scenarios.jsonl"))
	newest := newestFile(paths)
	if newest == "" {
		return nil
	}
	file, err := os.Open(newest) // #nosec G304 -- a sibling run of the suite.
	if err != nil {
		return nil
	}
	defer file.Close()
	from := filepath.Base(filepath.Dir(filepath.Dir(filepath.Dir(newest))))
	last := summary{outcome: outcome{Failing: []string{}}, BaselineFrom: from}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		last.countScenario(scanner.Bytes())
	}
	return &last
}

// newestFile is the most recently modified of paths, or "" when none can be read.
func newestFile(paths []string) string {
	newest, at := "", time.Time{}
	for _, path := range paths {
		if info, err := os.Stat(path); err == nil && info.ModTime().After(at) {
			newest, at = path, info.ModTime()
		}
	}
	return newest
}

// countScenario adds one scenarios.jsonl line to the summary; a line without an id is skipped.
func (last *summary) countScenario(body []byte) {
	var line struct{ ID, Verdict string }
	if json.Unmarshal(body, &line) != nil || line.ID == "" {
		return
	}
	if line.Verdict == "PASS" {
		last.Pass++
		return
	}
	last.Fail++
	last.Failing = append(last.Failing, line.Verdict+" "+line.ID)
}

// writeLatest replaces latest.json by rename, so an agent never reads half of it.
func writeLatest(toolDir string, done summary) {
	body, _ := json.MarshalIndent(done, "", "  ")
	if done.Dir != "" {
		os.WriteFile(filepath.Join(done.Dir, "summary.json"), body, 0o644)
	}
	temp := filepath.Join(toolDir, ".latest.json.tmp")
	if os.WriteFile(temp, body, 0o644) == nil {
		os.Rename(temp, filepath.Join(toolDir, "latest.json"))
	}
}

// gate holds a loop until the stack answers; after downGrace of silence it says STACK DOWN once.
type gate struct {
	mu        sync.Mutex
	clock     clock
	probe     func() bool
	say       func(format string, args ...any)
	downSince time.Time
	announced bool
}

func (g *gate) wait(ctx context.Context) error {
	for !g.observe(g.probe()) {
		if err := g.clock.sleep(ctx, healthEvery); err != nil {
			return err
		}
	}
	return ctx.Err()
}

func (g *gate) observe(up bool) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.clock.now()
	if up {
		if g.announced {
			g.say("[suite] STACK UP")
		}
		g.downSince, g.announced = time.Time{}, false
		return true
	}
	if g.downSince.IsZero() {
		g.downSince = now
	}
	if !g.announced && now.Sub(g.downSince) > downGrace {
		g.announced = true
		g.say("[suite] STACK DOWN: waiting for the stack to answer")
	}
	return false
}

// currentLoad is the 1m load average from uptime; unknown reads as idle.
func currentLoad() float64 {
	out, _ := exec.Command("uptime").Output()
	first, _, _ := strings.Cut(loadAverage(string(out)), " ")
	load, _ := strconv.ParseFloat(first, 64)
	return load
}

type continuousOptions struct {
	health      string
	visualEvery time.Duration
	loadMax     float64
}

// continuous loops every tool until ctx ends: api and fuzzapi back to back, the rest
// every visualEvery once the load allows. It never starts or resets a stack.
func (suite *suite) continuous(ctx context.Context, options continuousOptions) int {
	templates := map[string]*tool{}
	for _, tool := range suite.tools {
		templates[tool.name] = tool
	}
	jobs := continuousJobs(suite.tools, options.visualEvery)
	suite.tools, suite.policy, suite.began = nil, "none", time.Now()
	alive := func() bool { return healthy(options.health) }
	s := &session{
		out: suite.out, clock: realClock, say: suite.line, load: currentLoad,
		loadMax: options.loadMax,
		ready:   (&gate{clock: realClock, probe: alive, say: suite.line}).wait,
		prepare: suite.preparer(templates),
		run: func(ctx context.Context, name, dir string) outcome {
			return suite.runOnce(ctx, iterationOf(templates[name], dir), alive)
		},
	}
	if s.loadMax <= 0 {
		s.loadMax = float64(runtime.NumCPU())
	}
	finished := make(chan struct{})
	go suite.heartbeat(finished)
	go suite.stopOnCancel(ctx, finished)
	suite.line("[suite] continuous: %d tools against %s", len(jobs), options.health)
	var loops sync.WaitGroup
	for _, j := range jobs {
		loops.Add(1)
		go func() { defer loops.Done(); s.loop(ctx, j) }()
	}
	loops.Wait()
	close(finished)
	suite.line("[suite] continuous run ended")
	return 0
}

// continuousJobs loops api and fuzzapi back to back and the rest every visualEvery.
func continuousJobs(tools []*tool, visualEvery time.Duration) []job {
	jobs := make([]job, 0, len(tools))
	for _, tool := range tools {
		every := visualEvery
		if tool.name == "api" || tool.name == "fuzzapi" {
			every = 0
		}
		jobs = append(jobs, job{tool.name, every})
	}
	return jobs
}

// preparer builds a tool's binary when HEAD moved since its last build, one
// build at a time, and answers the commit.
func (suite *suite) preparer(templates map[string]*tool) func(ctx context.Context, name string) (string, error) {
	var buildMu sync.Mutex
	built := map[string]string{}
	return func(ctx context.Context, name string) (string, error) {
		buildMu.Lock()
		defer buildMu.Unlock()
		commit, template := headCommit(suite.root), templates[name]
		if template.binary == "" || built[template.binary] == commit {
			return commit, nil
		}
		if err := suite.build(ctx, []*tool{template}); err != nil {
			return "", err
		}
		built[template.binary] = commit
		return commit, nil
	}
}

// stopOnCancel stops every tool when ctx ends before finished closes.
func (suite *suite) stopOnCancel(ctx context.Context, finished <-chan struct{}) {
	select {
	case <-ctx.Done():
		suite.mu.Lock()
		defer suite.mu.Unlock()
		suite.stopAll("cancelled")
	case <-finished:
	}
}

// iterationOf is a copy of a tool's template that runs in dir.
func iterationOf(template *tool, dir string) *tool {
	copied := *template
	copied.dir = dir
	return &copied
}

// runOnce runs one iteration of a tool, a copy of its template set to its
// iteration directory, and answers what it showed.
func (suite *suite) runOnce(ctx context.Context, live *tool, alive func() bool) outcome {
	if err := suite.start(live); err != nil {
		suite.line("[%s] START FAILED: %v", live.name, err)
		return outcome{Exit: 2, Stopped: err.Error(), Failing: []string{}}
	}
	suite.mu.Lock()
	index := slices.IndexFunc(suite.tools, func(each *tool) bool { return each.name == live.name })
	if index < 0 {
		suite.tools = append(suite.tools, live)
	} else {
		suite.tools[index] = live
	}
	if ctx.Err() != nil {
		suite.signal(syscall.SIGKILL)
	}
	suite.mu.Unlock()
	suite.wait(live)
	suite.drain(live)
	suite.mu.Lock()
	defer suite.mu.Unlock()
	r := &live.results
	result := outcome{Exit: live.exit, Pass: r.pass, Fail: r.fail, Errors: r.errs, Failing: []string{}}
	for _, entry := range slices.Concat(r.failing, r.findings) {
		result.Failing = append(result.Failing, entry.line)
	}
	if result.Fail == 0 {
		result.Fail = len(r.failing)
	}
	result.Fail += len(r.findings)
	result.Latency = r.latency
	switch {
	case live.stop != nil:
		result.Stopped = cmpOr(live.stop.Reason, "tool stopped")
	case ctx.Err() != nil:
		result.Stopped = "cancelled"
	case !alive():
		result.Stopped = "stack unhealthy"
	}
	return result
}

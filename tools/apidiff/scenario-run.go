package apidiff

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// scenarioOptions is what the scenario phase needs to reach a pair of stacks.
type scenarioOptions struct {
	A, B         string // branch and main base URLs
	MailA, MailB string // each side's mail sink (mailsim) base URL, when known
	Keys         Keys
	Timeout      time.Duration
	Concurrency  int // scenarios in flight per side
	Shards       int // isolated projects and organizations seeded per side
	Repeat       int // debug: run every scenario this many times
	Glob         string
	IDs          []string
	RunDir       string
	SeedDir      string // shared stacks: where the seed record and its lock live
	Final        bool   // ignore the done ledger
	DryRun       bool   // load and validate only
	DoneRoot     string // repository root the done ledger sits under
	Progress     io.Writer
	MaxErrors    int // consecutive ERROR scenarios that stop the run; 0 never stops it
}

const (
	defaultScenarioConcurrency  = 48
	defaultScenarioShards       = 8
	defaultMaxConsecutiveErrors = 50
)

// scenarioSide is one stack under test: where it is, the credentials its
// shards hold and the pool slots its scenarios share.
type scenarioSide struct {
	name     string
	baseURL  string
	mailURL  string
	shared   *shardContext
	runOrg   *shardContext // the run's own organization for project shards, when the admin key can make one
	projects []*shardContext
	orgs     []*shardContext
	foreign  *shardContext
	creds    sideCredentials
	slots    chan struct{}
}

func (side *scenarioSide) acquire(ctx context.Context) {
	select {
	case side.slots <- struct{}{}:
	case <-ctx.Done():
	}
}

func (side *scenarioSide) release() {
	select {
	case <-side.slots:
	default:
	}
}

// scenarioRunner is one scenario phase: the pooled client, both sides and the
// counters the timing block reads.
type scenarioRunner struct {
	ctx       context.Context
	engine    *probeEngine
	options   scenarioOptions
	sides     []*scenarioSide
	tag       string
	requests  atomic.Int64
	waitNanos atomic.Int64
	liveMu    sync.Mutex
	live      map[string]int
	streak    *diffkit.Streak
	stopped   atomic.Bool
	cancel    context.CancelFunc
}

// stop ends the run early: scenarios not started are dropped, and the ones in
// flight are cancelled and left out of the results.
func (runner *scenarioRunner) stop() {
	runner.stopped.Store(true)
	runner.cancel()
}

// settle files one judged scenario with the streak: only an ERROR counts, a
// PASS ends the streak, and a FAIL does neither.
func (runner *scenarioRunner) settle(result *scenarioResult) {
	switch result.Verdict {
	case verdictError:
		if runner.streak.Error(result.FirstFail) {
			runner.stop()
		}
	case verdictPass:
		runner.streak.OK()
	}
}

func (runner *scenarioRunner) verdicts() []string {
	if len(runner.sides) == 1 {
		return singleVerdicts
	}
	return scenarioVerdicts
}

func verdictLabel(verdict string) string {
	if verdict == verdictError {
		return "err"
	}
	return strings.ToLower(verdict)
}

// tick files one judged scenario for the progress line.
func (runner *scenarioRunner) tick(verdict string) {
	runner.liveMu.Lock()
	defer runner.liveMu.Unlock()
	runner.live[verdict]++
}

// snapshot is the progress line's numbers: scenarios judged and their verdicts.
func (runner *scenarioRunner) snapshot() (int, string) {
	runner.liveMu.Lock()
	defer runner.liveMu.Unlock()
	done, parts := 0, []string{}
	for _, verdict := range runner.verdicts() {
		done += runner.live[verdict]
		if count := runner.live[verdict]; count > 0 || verdict == verdictPass {
			parts = append(parts, fmt.Sprintf("%d %s", count, verdictLabel(verdict)))
		}
	}
	return done, strings.Join(parts, " ")
}

// newScenarioClient keeps connections alive across the pool: one idle
// connection per scenario in flight on each stack.
func newScenarioClient(options scenarioOptions) *http.Client {
	perHost := max(options.Concurrency, 1) * 2
	transport := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		MaxIdleConns:        perHost * 4,
		MaxIdleConnsPerHost: perHost,
		IdleConnTimeout:     90 * time.Second,
	}
	return &http.Client{Timeout: options.Timeout, Transport: transport}
}

func newScenarioRunner(ctx context.Context, options scenarioOptions) *scenarioRunner {
	options.Concurrency = max(options.Concurrency, 1)
	ctx, cancel := context.WithCancel(ctx)
	if options.Progress == nil {
		options.Progress = io.Discard
	}
	engine := &probeEngine{
		ctx: ctx, client: newScenarioClient(options),
		options: ProbeOptions{A: options.A, B: options.B, Keys: options.Keys, Progress: options.Progress},
	}
	runner := &scenarioRunner{ctx: ctx, engine: engine, options: options, live: map[string]int{}, streak: diffkit.NewStreak(options.MaxErrors), cancel: cancel, tag: strconv.FormatInt(time.Now().Unix()%1_000_000_000, 36)}
	if options.B == "" {
		runner.sides = []*scenarioSide{newScenarioSide("stack", options.A, options.MailA, options)}
		return runner
	}
	runner.sides = []*scenarioSide{
		newScenarioSide("branch", options.A, options.MailA, options),
		newScenarioSide("main", options.B, options.MailB, options),
	}
	return runner
}

func newScenarioSide(name, baseURL, mailURL string, options scenarioOptions) *scenarioSide {
	return &scenarioSide{
		name: name, baseURL: baseURL, mailURL: mailURL, creds: sideCredentials{},
		shared: sharedShard(options.Keys),
		slots:  make(chan struct{}, options.Concurrency),
	}
}

// scenarioResult is one scenario across both sides, judged.
type scenarioResult struct {
	ID         string      `json:"id"`
	Endpoint   string      `json:"endpoint"`
	File       string      `json:"file"`
	Shard      string      `json:"shard"`
	Verdict    string      `json:"verdict"`
	FirstFail  string      `json:"firstFailure,omitempty"`
	Branch     sideOutcome `json:"branch"`
	Main       sideOutcome `json:"main"`
	Diff       []Finding   `json:"diff,omitempty"`
	DurationMS int64       `json:"durationMs"`
	item       *scenario
	order      int
	elapsed    time.Duration
	single     bool
}

// runAll runs every scenario: the pooled ones side by side, then the serial
// ones alone, each scenario's two sides at once.
func (runner *scenarioRunner) runAll(items []scenario) []scenarioResult {
	results := make([]scenarioResult, len(items))
	var pooled sync.WaitGroup
	var serial []int
	counters := map[string]int{}
	for index := range items {
		results[index] = scenarioResult{ID: items[index].ID, Endpoint: items[index].Endpoint, File: items[index].file, Shard: items[index].Shard, item: &items[index], order: index}
		if items[index].Shard == shardSerial {
			serial = append(serial, index)
			continue
		}
		pick := counters[items[index].Shard]
		counters[items[index].Shard]++
		pooled.Add(1)
		go func() {
			defer pooled.Done()
			runner.runOne(&results[index], pick)
		}()
	}
	pooled.Wait()
	if !runner.stopped.Load() {
		if unlock := runner.lockInstance(len(serial)); unlock != nil {
			defer unlock()
		}
		for _, index := range serial {
			runner.runOne(&results[index], 0)
		}
	}
	return judged(results)
}

// judged drops the scenarios a stopped run never judged.
func judged(results []scenarioResult) []scenarioResult {
	kept := results[:0]
	for index := range results {
		if results[index].Verdict != "" {
			kept = append(kept, results[index])
		}
	}
	return kept
}

// lockInstance holds the shared stack's instance-wide lock for the serial pass,
// so two tools never change licence or ops state at once.
func (runner *scenarioRunner) lockInstance(serial int) func() {
	if serial == 0 || len(runner.sides) != 1 || runner.options.DoneRoot == "" {
		return nil
	}
	say := func(text string) { fmt.Fprintln(runner.options.Progress, text) }
	unlock, err := lockFile(filepath.Join(runner.options.DoneRoot, ".visualdiff", "check"), "instance.lock", "scenarios: another tool holds the instance lock; the serial pass waits", say)
	if err != nil {
		say("scenarios: instance lock: " + err.Error())
		return nil
	}
	return unlock
}

// runOne runs one scenario on both sides at once and judges the pair.
func (runner *scenarioRunner) runOne(result *scenarioResult, pick int) {
	if runner.stopped.Load() {
		return
	}
	started := time.Now()
	var sides sync.WaitGroup
	outcomes := []*sideOutcome{&result.Branch, &result.Main}
	result.single = len(runner.sides) == 1
	for index, side := range runner.sides {
		sides.Add(1)
		go func() {
			defer sides.Done()
			runner.runSide(side, result, pick, outcomes[index])
		}()
	}
	sides.Wait()
	if runner.stopped.Load() {
		return
	}
	result.elapsed = time.Since(started)
	result.DurationMS = result.elapsed.Milliseconds()
	runner.judgePair(result)
	runner.tick(result.Verdict)
	runner.settle(result)
}

func (runner *scenarioRunner) runSide(side *scenarioSide, result *scenarioResult, pick int, out *sideOutcome) {
	side.acquire(runner.ctx)
	defer side.release()
	shard := side.shardFor(result.item.Shard, pick)
	exec := &scenarioExec{runner: runner, side: side, item: result.item, shard: shard, out: out}
	exec.vars = runner.varsFor(side, shard, result)
	exec.run()
}

func (side *scenarioSide) shardFor(kind string, pick int) *shardContext {
	switch kind {
	case shardProject:
		return pickShard(side.projects, pick, "project")
	case shardOrg:
		return pickShard(side.orgs, pick, "org")
	}
	return side.shared
}

func pickShard(shards []*shardContext, pick int, kind string) *shardContext {
	if len(shards) == 0 {
		return &shardContext{err: "no isolated " + kind + " was seeded on this stack"}
	}
	return shards[pick%len(shards)]
}

// varsFor is the placeholders every step of one scenario on one side can use.
func (runner *scenarioRunner) varsFor(side *scenarioSide, shard *shardContext, result *scenarioResult) map[string]string {
	vars := make(map[string]string, len(shard.vars)+4)
	for name, value := range shard.vars {
		vars[name] = value
	}
	vars["uid"] = fmt.Sprintf("%s%05d", runner.tag, result.order)
	vars["UID"] = strings.ToUpper(vars["uid"])
	vars["side"] = side.name
	if sibling := side.sibling(shard); sibling != nil {
		vars["projectIdB"], vars["projectKeyB"] = sibling.vars["projectId"], sibling.keys.ProjectKey
	}
	if foreign := side.foreign; foreign != nil && foreign.err == "" {
		vars["orgIdC"], vars["teamIdC"], vars["projectIdC"] = foreign.vars["orgId"], foreign.vars["teamId"], foreign.vars["projectId"]
		vars["orgKeyC"], vars["projectKeyC"] = foreign.keys.OrgKey, foreign.keys.ProjectKey
	}
	vars["adminEmail"] = adminEmailFor(side.name)
	if _, set := vars["userId"]; !set {
		vars["userId"] = seededAdminUserID
	}
	digest := sha256.Sum256([]byte(vars["uid"] + side.name))
	vars["uidHex32"] = hex.EncodeToString(digest[:16])
	vars["uidHex16"] = vars["uidHex32"][:16]
	return vars
}

func adminEmailFor(side string) string {
	if side == "main" {
		return seededAdminEmails[1]
	}
	return seededAdminEmails[0]
}

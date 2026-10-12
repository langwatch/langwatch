package workerrun

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"time"
)

// failure is one failing id (stable across runs) and why.
type failure struct {
	ID     string `json:"id"`
	Family string `json:"family"`
	Detail string `json:"detail"`
}

// lag is how long items took from fire to read-back, at the read-back round's resolution.
type lag struct {
	P50Ms int64 `json:"p50Ms"`
	P95Ms int64 `json:"p95Ms"`
	MaxMs int64 `json:"maxMs"`
}

type familyResult struct {
	Verdict string            `json:"verdict"` // pass, fail or skipped
	Reason  string            `json:"reason,omitempty"`
	Total   int               `json:"total"`
	Fired   int               `json:"fired"`
	Landed  []string          `json:"landed"`
	Missing map[string]string `json:"missing"`
	Lag     lag               `json:"lag"`
}

type drainReport struct {
	Source     string           `json:"source"`
	Error      string           `json:"error,omitempty"`
	Before     map[string]depth `json:"before"`
	Peak       map[string]depth `json:"peak"`
	After      map[string]depth `json:"after"`
	DLQBefore  int              `json:"dlqBefore"`
	DLQAfter   int              `json:"dlqAfter"`
	DrainedMs  int64            `json:"drainedMs"` // after read-back ended; -1 never
	LimitMs    int64            `json:"limitMs"`
	Pipelines  []string         `json:"pipelines"`
	Router502s map[string]int   `json:"router502s"`
}

type healthReport struct {
	Probes    int    `json:"probes"`
	Stalls    int    `json:"stalls"`
	Gateway   int    `json:"gateway502s"`
	SlowestMs int64  `json:"slowestMs"`
	Worst     string `json:"worst,omitempty"`
}

// runSummary is summary.json: per-family verdicts, drain, health, log signatures, and
// the failing ids with what is new or fixed against the previous run's summary.json.
type runSummary struct {
	Tool       string                  `json:"tool"`
	Run        string                  `json:"run"`
	Stack      string                  `json:"stack"`
	Project    string                  `json:"project"`
	StartedAt  time.Time               `json:"startedAt"`
	DurationMs int64                   `json:"durationMs"`
	Options    map[string]any          `json:"options"`
	Families   map[string]familyResult `json:"families"`
	Drain      drainReport             `json:"drain"`
	Health     healthReport            `json:"health"`
	Log        string                  `json:"log"`
	LogError   string                  `json:"logError,omitempty"`
	Signatures []signature             `json:"signatures"`
	Pass       int                     `json:"pass"`
	Fail       int                     `json:"fail"`
	Failing    []failure               `json:"failing"`
	Baseline   string                  `json:"baseline"`
	New        []string                `json:"new"`
	Fixed      []string                `json:"fixed"`
}

// observed is everything the run watched, handed to report.
type observed struct {
	items      []*item
	drain      *drainWatch
	health     *healthWatch
	signatures []signature
	logPath    string
	logErr     error
}

func (run *run) report(seen observed) int {
	run.mu.Lock()
	defer run.mu.Unlock()
	summary := run.newSummary(seen)
	failing, pass := run.familyResults(&summary, seen.items)
	summary.Drain, failing = run.drainFailures(seen.drain, failing)
	summary.Health, failing = healthFailures(seen.health, failing)
	failing = append(failing, run.logFailures(seen)...)
	summary.Pass, summary.Fail, summary.Failing = pass, len(failing), append(summary.Failing, failing...)
	summary.Baseline, summary.New, summary.Fixed = compare(run.runDir, failing)
	run.printVerdict(summary, failing)
	return run.writeSummary(summary)
}

func (run *run) newSummary(seen observed) runSummary {
	summary := runSummary{Tool: "worker", Run: run.tag, Stack: cmpOr(run.slug, run.appURL), Project: run.projectID,
		StartedAt: run.began, DurationMs: time.Since(run.began).Milliseconds(), Families: map[string]familyResult{},
		Options: map[string]any{"n": run.options.N, "concurrency": run.options.Concurrency, "seed": run.options.Seed,
			"steadyRate": run.options.SteadyRate, "deadline": run.options.Deadline.String(), "families": run.chosen()},
		Log: seen.logPath, Signatures: seen.signatures, Failing: []failure{}}
	if seen.logErr != nil {
		summary.LogError = seen.logErr.Error()
	}
	return summary
}

// familyResults records each family that ran into summary and answers the failures and the pass count.
func (run *run) familyResults(summary *runSummary, items []*item) ([]failure, int) {
	var failing []failure
	pass := 0
	for _, family := range familyNames {
		result, fails := run.familyResult(family, items)
		if result.Total == 0 && result.Verdict == "" {
			continue
		}
		summary.Families[family] = result
		pass += len(result.Landed)
		failing = append(failing, fails...)
		fmt.Fprintf(run.out, "family %s: %s, landed %d/%d, lag p50 %dms p95 %dms max %dms%s\n", family, result.Verdict,
			len(result.Landed), result.Total, result.Lag.P50Ms, result.Lag.P95Ms, result.Lag.MaxMs, suffix(result.Reason))
	}
	return failing, pass
}

// logFailures are an unreadable log and the error signatures in scope.
func (run *run) logFailures(seen observed) []failure {
	var failing []failure
	if seen.logErr != nil && seen.logPath != "" {
		failing = append(failing, failure{"log-unread", "log", seen.logErr.Error()})
	}
	for _, found := range seen.signatures {
		if found.Ours || run.options.LogScope == "all" {
			failing = append(failing, failure{found.ID, "log", fmt.Sprintf("%s x%d: %s", found.Level, found.Count, found.Message)})
		}
	}
	return failing
}

func (run *run) printVerdict(summary runSummary, failing []failure) {
	for _, fail := range failing {
		fmt.Fprintf(run.out, "FAIL %s (%s, %s)\n", fail.ID, fail.Family, oneLine(fail.Detail))
	}
	fmt.Fprintf(run.out, "worker: %d checked: %d pass, %d fail\n", summary.Pass+summary.Fail, summary.Pass, summary.Fail)
	if len(summary.New)+len(summary.Fixed) > 0 {
		fmt.Fprintf(run.out, "worker: vs %s: new %v fixed %v\n", summary.Baseline, summary.New, summary.Fixed)
	}
}

// writeSummary saves summary.json and answers the exit code: 1 on a failure or a write error.
func (run *run) writeSummary(summary runSummary) int {
	path := filepath.Join(run.runDir, "summary.json")
	encoded, _ := json.MarshalIndent(summary, "", "  ")
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		fmt.Fprintf(run.errOut, "workerrun: %v\n", err)
		return 1
	}
	fmt.Fprintf(run.out, "workerrun: summary %s\n", path)
	if summary.Fail > 0 {
		return 1
	}
	return 0
}

func suffix(reason string) string {
	if reason == "" {
		return ""
	}
	return " (" + reason + ")"
}

// familyResult is one family's verdict; each item that never landed fails by its id.
func (run *run) familyResult(family string, items []*item) (familyResult, []failure) {
	result := familyResult{Landed: []string{}, Missing: map[string]string{}}
	if reason, ok := run.skipped[family]; ok {
		result.Verdict, result.Reason = "skipped", reason
		fmt.Fprintf(run.out, "SKIP %s (%s)\n", family, reason)
		return result, nil
	}
	if reason, ok := run.setupFailed[family]; ok {
		result.Verdict, result.Reason = "fail", "setup: "+reason
		return result, []failure{{family + "-setup", family, reason}}
	}
	fails, lags := run.tally(&result, family, items)
	if result.Total == 0 {
		return familyResult{}, nil
	}
	sort.Strings(result.Landed)
	result.Lag = percentiles(lags)
	result.Verdict = "pass"
	if len(fails) > 0 {
		result.Verdict = "fail"
	}
	return result, fails
}

// tally counts family's items into result and answers the ones that never landed and the landed lags.
func (run *run) tally(result *familyResult, family string, items []*item) ([]failure, []time.Duration) {
	var fails []failure
	var lags []time.Duration
	for _, it := range items {
		if it.family != family {
			continue
		}
		result.Total++
		if it.fired && it.fireErr == "" {
			result.Fired++
		}
		if it.landed {
			result.Landed = append(result.Landed, it.id)
			began, _ := run.start(it)
			lags = append(lags, it.landedAt.Sub(began))
			continue
		}
		fails = append(fails, missing(result, it))
	}
	return fails, lags
}

// missing records why an item never landed; an item still open was cut off by the read-back ending.
func missing(result *familyResult, it *item) failure {
	detail := it.detail
	if !it.final {
		detail = "read-back stopped: " + detail
	}
	result.Missing[it.id] = detail
	return failure{it.id, it.family, detail}
}

func percentiles(lags []time.Duration) lag {
	if len(lags) == 0 {
		return lag{}
	}
	slices.Sort(lags)
	at := func(q float64) int64 {
		return lags[max(0, int(math.Ceil(q*float64(len(lags))))-1)].Milliseconds()
	}
	return lag{P50Ms: at(0.5), P95Ms: at(0.95), MaxMs: lags[len(lags)-1].Milliseconds()}
}

// drainFailures: a watched pipeline still above its depth before the load, more blocked
// groups or dead letters than before, or no snapshot at all, each fail by name.
func (run *run) drainFailures(drain *drainWatch, failing []failure) (drainReport, []failure) {
	drain.mu.Lock()
	defer drain.mu.Unlock()
	report := run.newDrainReport(drain)
	if drain.before == nil {
		return report, append(failing, failure{"drain-unproven", "drain", drain.err})
	}
	for _, name := range drain.pipelines {
		failing = append(failing, run.pipelineFailures(drain, name)...)
	}
	if drain.dlqLast > drain.dlqBefore {
		failing = append(failing, failure{"dead-letters", "drain", fmt.Sprintf("dead letters %d, %d before the load", drain.dlqLast, drain.dlqBefore)})
	}
	return report, append(failing, run.routerFailures()...)
}

func (run *run) newDrainReport(drain *drainWatch) drainReport {
	report := drainReport{Source: "ops.getDashboardSnapshot (seeded operator session)", Error: drain.err,
		Before: drain.before, Peak: drain.peak, After: drain.last, DLQBefore: drain.dlqBefore, DLQAfter: drain.dlqLast,
		DrainedMs: -1, LimitMs: run.options.Drain.Milliseconds(), Pipelines: drain.pipelines, Router502s: run.fired502}
	if drain.drained >= 0 {
		report.DrainedMs = drain.drained.Milliseconds()
	}
	return report
}

func (run *run) pipelineFailures(drain *drainWatch, name string) []failure {
	var failing []failure
	before, after := drain.before[name], drain.last[name]
	if drain.drained < 0 && after.Pending > before.Pending {
		failing = append(failing, failure{"drain-" + name, "drain",
			fmt.Sprintf("pending %d, %d before the load, peak %d, after %s", after.Pending, before.Pending, drain.peak[name].Pending, run.options.Drain)})
	}
	if after.Blocked > before.Blocked {
		failing = append(failing, failure{"blocked-" + name, "drain", fmt.Sprintf("blocked %d, %d before the load", after.Blocked, before.Blocked)})
	}
	return failing
}

// routerFailures is a 502 from the router on any request this run sent.
func (run *run) routerFailures() []failure {
	total := 0
	for _, count := range run.fired502 {
		total += count
	}
	if total == 0 {
		return nil
	}
	return []failure{{"router-502", "health", fmt.Sprintf("%d of this run's requests answered 502: %v", total, run.fired502)}}
}

func healthFailures(health *healthWatch, failing []failure) (healthReport, []failure) {
	health.mu.Lock()
	defer health.mu.Unlock()
	report := healthReport{Probes: health.probes, Stalls: health.stalls, Gateway: health.gateway,
		SlowestMs: health.slowest.Milliseconds(), Worst: health.worst}
	if health.stalls > 0 {
		failing = append(failing, failure{"health-stall", "health",
			fmt.Sprintf("%d of %d probes over %s or failing, worst %s", health.stalls, health.probes, stallAfter, health.worst)})
	}
	if health.gateway > 0 {
		failing = append(failing, failure{"health-502", "health", fmt.Sprintf("%d probes answered 502", health.gateway)})
	}
	return report, failing
}

// compare reads the newest earlier summary.json beside this run (a sibling run
// directory, or diffsuite's previous iteration) and answers the new and fixed ids.
func compare(runDir string, failing []failure) (string, []string, []string) {
	own := filepath.Join(runDir, "summary.json")
	siblings, _ := filepath.Glob(filepath.Join(filepath.Dir(runDir), "*", "summary.json"))
	cousins, _ := filepath.Glob(filepath.Join(filepath.Dir(filepath.Dir(runDir)), "*", filepath.Base(runDir), "summary.json"))
	newest, at := "", time.Time{}
	for _, path := range slices.Concat(siblings, cousins) {
		if info, err := os.Stat(path); err == nil && path != own && info.ModTime().After(at) {
			newest, at = path, info.ModTime()
		}
	}
	now := make([]string, 0, len(failing))
	for _, fail := range failing {
		now = append(now, fail.ID)
	}
	if newest == "" {
		return "", []string{}, []string{}
	}
	body, err := os.ReadFile(newest) // #nosec G304 -- a sibling run's own summary.
	var before runSummary
	if err != nil || json.Unmarshal(body, &before) != nil || before.Tool != "worker" {
		return "", []string{}, []string{}
	}
	earlier := make([]string, 0, len(before.Failing))
	for _, fail := range before.Failing {
		earlier = append(earlier, fail.ID)
	}
	added, fixed := delta(earlier, now)
	return newest, added, fixed
}

// delta answers the ids failing now and not before, and before and not now.
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

package apidiff

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Scenario verdicts. FAIL-branch is the finding; FAIL-both is a script bug
// until shown otherwise; FAIL-main and FAIL-diff are the two other ways the
// pair can disagree; ERROR is the harness, never the API.
const (
	verdictPass       = "PASS"
	verdictFailBranch = "FAIL-branch"
	verdictFail       = "FAIL"
	verdictFailMain   = "FAIL-main"
	verdictFailBoth   = "FAIL-both"
	verdictFailDiff   = "FAIL-diff"
	verdictError      = "ERROR"
)

var scenarioVerdicts = []string{verdictPass, verdictFailBranch, verdictFailMain, verdictFailBoth, verdictFailDiff, verdictError}

// singleVerdicts are the only verdicts a run against one stack can give.
var singleVerdicts = []string{verdictPass, verdictFail, verdictError}

func verdictsOf(results []scenarioResult) []string {
	if len(results) > 0 && results[0].single {
		return singleVerdicts
	}
	return scenarioVerdicts
}

// judgePair decides one scenario's verdict from its two sides.
func (runner *scenarioRunner) judgePair(result *scenarioResult) {
	branch, main := &result.Branch, &result.Main
	if result.single {
		judgeSingle(result)
		return
	}
	switch {
	case branch.Error != "" || main.Error != "":
		result.Verdict = verdictError
		result.FirstFail = firstOf("branch", branch.Error, "main", main.Error)
	case branch.Failure != "" && main.Failure != "":
		result.Verdict = verdictFailBoth
		result.FirstFail = "branch " + branch.Failure
	case branch.Failure != "":
		result.Verdict = verdictFailBranch
		result.FirstFail = branch.Failure
	case main.Failure != "":
		result.Verdict = verdictFailMain
		result.FirstFail = main.Failure
	default:
		runner.judgeAgreement(result)
	}
}

func judgeSingle(result *scenarioResult) {
	switch branch := &result.Branch; {
	case branch.Error != "":
		result.Verdict, result.FirstFail = verdictError, branch.Error
	case branch.Failure != "":
		result.Verdict, result.FirstFail = verdictFail, branch.Failure
	default:
		result.Verdict = verdictPass
	}
}

func firstOf(nameA, textA, nameB, textB string) string {
	if textA != "" {
		return nameA + ": " + textA
	}
	return nameB + ": " + textB
}

// judgeAgreement holds the two sides' main responses to the normalizer: a
// scenario that held on both sides still fails when they answered differently.
func (runner *scenarioRunner) judgeAgreement(result *scenarioResult) {
	result.Verdict = verdictPass
	if !result.Branch.mainSent || !result.Main.mainSent {
		return
	}
	method, path, _ := strings.Cut(result.Endpoint, " ")
	comparison := Comparison{Method: method, Path: path, Case: result.ID, ExactStatus: true}
	outcome := CompareResults(comparison, result.Main.main, result.Branch.main)
	if len(outcome.Findings) == 0 {
		return
	}
	result.Verdict, result.Diff = verdictFailDiff, outcome.Findings
	result.FirstFail = "the sides answered differently: " + diffSummary(outcome.Findings)
}

func diffSummary(findings []Finding) string {
	parts := make([]string, 0, len(findings))
	for _, finding := range findings {
		parts = append(parts, finding.Kind+" "+fieldsSummary(finding.Fields))
	}
	return strings.Join(parts, "; ")
}

func fieldsSummary(fields map[string][2]any) string {
	names := make([]string, 0, len(fields))
	for name := range fields {
		names = append(names, name)
	}
	sort.Strings(names)
	parts := make([]string, 0, len(names))
	for _, name := range names {
		parts = append(parts, fmt.Sprintf("%s: main %s, branch %s", name, excerptValue(fields[name][0]), excerptValue(fields[name][1])))
	}
	return strings.Join(parts, ", ")
}

// scenarioTally counts the verdicts.
func scenarioTally(results []scenarioResult) map[string]int {
	counts := map[string]int{}
	for index := range results {
		counts[results[index].Verdict]++
	}
	return counts
}

func tallyLine(results []scenarioResult) string {
	counts := scenarioTally(results)
	parts := make([]string, 0, len(scenarioVerdicts))
	for _, verdict := range verdictsOf(results) {
		parts = append(parts, fmt.Sprintf("%d %s", counts[verdict], verdict))
	}
	return fmt.Sprintf("scenarios: %d run: %s", len(results), strings.Join(parts, ", "))
}

// scenarioExit is the phase's contribution to the exit code: 2 when the
// harness could not measure, 1 when anything failed, else 0.
func scenarioExit(results []scenarioResult) int {
	counts := scenarioTally(results)
	switch {
	case counts[verdictError] > 0:
		return exitError
	case len(results) > counts[verdictPass]:
		return exitDifferences
	}
	return exitEqual
}

// writeScenarioReport prints every scenario that did not pass, the tally and
// the timing block.
func writeScenarioReport(out io.Writer, results []scenarioResult, timing scenarioTiming) {
	for index := range results {
		if results[index].Verdict != verdictPass {
			writeScenarioFailure(out, &results[index])
		}
	}
	fmt.Fprintln(out, tallyLine(results))
	writeTiming(out, results, timing)
}

func writeScenarioFailure(out io.Writer, result *scenarioResult) {
	fmt.Fprintf(out, "%-11s %s  (%s, %s)\n", result.Verdict, result.ID, result.Endpoint, filepath.Base(result.File))
	fmt.Fprintf(out, "  first failing step: %s\n", result.FirstFail)
	if result.single {
		writeSideAnswer(out, "stack ", &result.Branch)
		return
	}
	writeSideAnswer(out, "branch", &result.Branch)
	writeSideAnswer(out, "main  ", &result.Main)
}

func writeSideAnswer(out io.Writer, name string, side *sideOutcome) {
	switch {
	case side.Error != "":
		fmt.Fprintf(out, "  %s: ERROR %s\n", name, side.Error)
	case side.Failure != "":
		fmt.Fprintf(out, "  %s: FAILED %s\n", name, side.Failure)
		writeFailedStep(out, side)
	default:
		fmt.Fprintf(out, "  %s: held (%s)\n", name, mainAnswer(side))
	}
}

func writeFailedStep(out io.Writer, side *sideOutcome) {
	for index := len(side.Steps) - 1; index >= 0; index-- {
		if step := side.Steps[index]; step.Detail != "" {
			fmt.Fprintf(out, "      %s %s %s -> %d %s\n", step.Step, step.Method, step.Path, step.Status, step.Body)
			return
		}
	}
}

func mainAnswer(side *sideOutcome) string {
	if !side.mainSent {
		return "no main request"
	}
	return fmt.Sprintf("%d %s", side.main.Status, excerpt(side.main.Body))
}

// scenarioTiming is what the run measured about itself.
type scenarioTiming struct {
	Wall     time.Duration
	Requests int64
	Waits    time.Duration
	Workers  int
}

func writeTiming(out io.Writer, results []scenarioResult, timing scenarioTiming) {
	if len(results) == 0 {
		return
	}
	durations := make([]time.Duration, len(results))
	for index := range results {
		durations[index] = results[index].elapsed
	}
	sort.Slice(durations, func(left, right int) bool { return durations[left] < durations[right] })
	wall := max(timing.Wall.Seconds(), 0.001)
	fmt.Fprintf(out, "timing: wall %s, %.1f scenarios/s, %d requests (%.0f/s), %d in flight per side\n",
		timing.Wall.Round(time.Millisecond), float64(len(results))/wall, timing.Requests, float64(timing.Requests)/wall, timing.Workers)
	fmt.Fprintf(out, "timing: per scenario p50 %s, p95 %s; time in eventually waits %s (summed over both sides)\n",
		percentile(durations, 50), percentile(durations, 95), timing.Waits.Round(time.Millisecond))
	writeSlowest(out, results)
}

func percentile(sorted []time.Duration, rank int) time.Duration {
	index := min(len(sorted)-1, len(sorted)*rank/100)
	return sorted[index].Round(time.Millisecond)
}

func writeSlowest(out io.Writer, results []scenarioResult) {
	order := make([]int, len(results))
	for index := range order {
		order[index] = index
	}
	sort.Slice(order, func(left, right int) bool { return results[order[left]].elapsed > results[order[right]].elapsed })
	fmt.Fprintln(out, "timing: slowest 10")
	for _, index := range order[:min(10, len(order))] {
		fmt.Fprintf(out, "  %8s  %s\n", results[index].elapsed.Round(time.Millisecond), results[index].ID)
	}
}

// writeScenariosJSONL files one line per scenario under the run directory.
func writeScenariosJSONL(dir string, results []scenarioResult) (string, error) {
	if dir == "" {
		return "", nil
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	target := filepath.Join(dir, "scenarios.jsonl")
	file, err := os.Create(target) // #nosec G304 -- the run directory apidiff owns
	if err != nil {
		return "", err
	}
	encoder := json.NewEncoder(file)
	for index := range results {
		if err := encoder.Encode(&results[index]); err != nil {
			_ = file.Close()
			return "", err
		}
	}
	return target, file.Close()
}

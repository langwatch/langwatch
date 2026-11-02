package ciguard

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// A push to main runs package-suites as one job, queues behind the run before
// it and posts a red run to Slack. See specs/ci/package-suite-integration-lane.feature.
// Browser suites run on a leg of their own. See specs/ci/browser-test-lane.feature.

// AppCIWorkflow is the workflow that runs the package suites.
const AppCIWorkflow = ".github/workflows/langwatch-app-ci.yml"

const (
	oneJobOutput   = "${{ github.event_name == 'push' }}"
	oneJobFlag     = "needs.changes.outputs.suites-one-job == 'true'"
	mainQueues     = "${{ github.event_name != 'push' || github.ref != 'refs/heads/main' }}"
	sharedCacheKey = "nx-suites-all-"
	notifyCommand  = "go run ./cmd/slacknotify"
	shardTotal     = "matrix.total"
	lanesFromLeg   = "${{ matrix.lanes }}"
)

// Every field a workflow may write as a scalar, a list or a mapping is a
// yaml.Node, so any legal shape decodes and only the wrong one is reported.
type suitesWorkflow struct {
	Concurrency ciscan.Concurrency   `yaml:"concurrency"`
	Jobs        map[string]suitesJob `yaml:"jobs"`
}

type suitesJob struct {
	Needs    yaml.Node            `yaml:"needs"`
	If       string               `yaml:"if"`
	Name     string               `yaml:"name"`
	Timeout  yaml.Node            `yaml:"timeout-minutes"`
	Outputs  map[string]yaml.Node `yaml:"outputs"`
	Strategy struct {
		Matrix yaml.Node `yaml:"matrix"`
	} `yaml:"strategy"`
	Steps []suitesStep `yaml:"steps"`
}

type suitesStep struct {
	Name string            `yaml:"name"`
	With map[string]string `yaml:"with"`
	Env  map[string]string `yaml:"env"`
	Run  string            `yaml:"run"`
}

// MainSuites reports every way a push to main could stop running the suites as
// one queued job, or stop telling Slack when that job fails or times out.
func MainSuites(repoRoot string) ([]string, error) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, AppCIWorkflow))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", AppCIWorkflow, err)
	}
	var wf suitesWorkflow
	if err := yaml.Unmarshal(raw, &wf); err != nil {
		return nil, fmt.Errorf("parse %s: %w", AppCIWorkflow, err)
	}

	var problems []string
	if cancel, _ := wf.Concurrency.CancelInProgress.(string); cancel != mainQueues {
		problems = append(problems, "cancel-in-progress must be "+mainQueues+", so a push to main queues behind the run before it")
	}
	if output := wf.Jobs["changes"].Outputs["suites-one-job"]; output.Value != oneJobOutput {
		problems = append(problems, "changes must output suites-one-job: "+oneJobOutput)
	}
	problems = append(problems, oneJobProblems(wf.Jobs["package-suites"])...)
	problems = append(problems, browserLegProblems(wf.Jobs["package-suites"])...)
	problems = append(problems, notifyProblems(wf.Jobs)...)

	return problems, nil
}

func oneJobProblems(job suitesJob) []string {
	var problems []string
	if shard := mappingValue(job.Strategy.Matrix, "shard"); !strings.Contains(shard, oneJobFlag+" && '[1]'") {
		problems = append(problems, "package-suites must run one shard when suites-one-job is true")
	}
	if !strings.Contains(job.Timeout.Value, oneJobFlag) {
		problems = append(problems, "package-suites must lengthen its timeout when suites-one-job is true")
	}
	// strategy.job-total counts the browser leg too, so the shard count is a matrix value.
	if total := mappingValue(job.Strategy.Matrix, "total"); !strings.Contains(total, oneJobFlag+" && '[1]'") {
		problems = append(problems, "package-suites must count one shard when suites-one-job is true")
	}
	problems = append(problems, shardCountProblems(job.Strategy.Matrix)...)
	if !strings.Contains(job.Name, shardTotal) {
		problems = append(problems, "package-suites must name its shard count from "+shardTotal)
	}
	sharded, cached := false, 0
	for _, step := range job.Steps {
		if strings.Contains(step.Env["PACKAGE_SUITES_SHARD"], shardTotal) {
			sharded = true
		}
		if strings.Contains(step.With["restore-keys"], sharedCacheKey) {
			cached++
		}
	}
	if !sharded {
		problems = append(problems, "PACKAGE_SUITES_SHARD must take its total from "+shardTotal)
	}
	if cached != 2 {
		problems = append(problems, fmt.Sprintf("both suite-result caches must fall back to %s, %d do", sharedCacheKey, cached))
	}

	return problems
}

// quotedList is a JSON list quoted inside a fromJSON(... && '[..]' || '[..]') expression.
var quotedList = regexp.MustCompile(`'(\[[^']*\])'`)

// shardCountProblems wants each total, one-job and sharded, to count its shard
// list: a total above the list leaves whole shards' packages unrun while green.
func shardCountProblems(matrix yaml.Node) []string {
	shards := quotedList.FindAllStringSubmatch(mappingValue(matrix, "shard"), -1)
	totals := quotedList.FindAllStringSubmatch(mappingValue(matrix, "total"), -1)
	if len(shards) != 2 || len(totals) != 2 {
		return []string{"package-suites must list its shards and their total for one job and for a pull request"}
	}
	var problems []string
	for i := range shards {
		var list, total []int
		if json.Unmarshal([]byte(shards[i][1]), &list) != nil || json.Unmarshal([]byte(totals[i][1]), &total) != nil || len(total) != 1 {
			problems = append(problems, "package-suites shard lists and totals must be JSON lists of numbers")
			continue
		}
		if total[0] != len(list) {
			problems = append(problems, fmt.Sprintf("package-suites total %d must count its %d shards", total[0], len(list)))
		}
	}

	return problems
}

// browserLegProblems wants a matrix leg that runs only the browser suites and
// every leg telling the script its lanes: a container starting beside a browser
// suite changes the network, and Chromium aborts with ERR_NETWORK_CHANGED.
func browserLegProblems(job suitesJob) []string {
	var problems []string
	if !hasBrowserLeg(mappingNode(job.Strategy.Matrix, "include")) {
		problems = append(problems, "package-suites must include a leg with lanes: browser")
	}
	// Without it the numbered legs get no lanes, run every lane and start Chromium beside containers again.
	if lanes := mappingNode(job.Strategy.Matrix, "lanes"); lanes == nil || lanes.Kind != yaml.SequenceNode || len(lanes.Content) != 1 || lanes.Content[0].Value != "no-browser" {
		problems = append(problems, "package-suites numbered legs must set lanes: [no-browser]")
	}
	if !slices.ContainsFunc(job.Steps, func(step suitesStep) bool { return step.Env["PACKAGE_SUITES_LANES"] == lanesFromLeg }) {
		problems = append(problems, "the package suites step must set PACKAGE_SUITES_LANES: "+lanesFromLeg)
	}

	return problems
}

func hasBrowserLeg(include *yaml.Node) bool {
	if include == nil || include.Kind != yaml.SequenceNode {
		return false
	}

	return slices.ContainsFunc(include.Content, func(leg *yaml.Node) bool { return mappingValue(*leg, "lanes") == "browser" })
}

// notifyProblems wants a job after package-suites, so a timeout (cancelled, with
// no failed step) still posts.
func notifyProblems(jobs map[string]suitesJob) []string {
	for name := range jobs {
		job := jobs[name]
		if !needsJob(job.Needs, "package-suites") || !runsScript(job.Steps, notifyCommand) {
			continue
		}
		var problems []string
		// One post per red leg; a failed jobs lookup falls back to the one-job leg instead of posting nothing.
		for _, want := range []string{`-job-prefix "package-suites ("`, `-fallback-job "package-suites (1/1)"`} {
			if !runsScript(job.Steps, want) {
				problems = append(problems, "the package-suites Slack step must run "+want)
			}
		}
		for _, want := range []string{"always()", "refs/heads/main", "needs.package-suites.result == 'failure'", "needs.package-suites.result == 'cancelled'"} {
			if !strings.Contains(job.If, want) {
				problems = append(problems, "the package-suites Slack job's if must include "+want)
			}
		}

		return problems
	}

	return []string{"no job after package-suites runs " + notifyCommand}
}

// mappingValue is key's scalar in a mapping node, "" for any other shape.
func mappingValue(node yaml.Node, key string) string {
	if value := mappingNode(node, key); value != nil && value.Kind == yaml.ScalarNode {
		return value.Value
	}

	return ""
}

// mappingNode is key's value in a mapping node, nil for any other shape.
func mappingNode(node yaml.Node, key string) *yaml.Node {
	if node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}

	return nil
}

func needsJob(needs yaml.Node, name string) bool {
	if needs.Kind == yaml.ScalarNode {
		return needs.Value == name
	}
	for _, item := range needs.Content {
		if item.Value == name {
			return true
		}
	}

	return false
}

func runsScript(steps []suitesStep, script string) bool {
	for _, step := range steps {
		if strings.Contains(step.Run, script) {
			return true
		}
	}

	return false
}

package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// A push to main splits package-suites like a pull request, queues behind the run
// before it and posts a red run to Slack. See specs/ci/package-suite-integration-lane.feature.

// AppCIWorkflow is the workflow that runs the package suites.
const AppCIWorkflow = ".github/workflows/langwatch-app-ci.yml"

const (
	mainQueues    = "${{ github.event_name != 'push' || github.ref != 'refs/heads/main' }}"
	shardCacheKey = "nx-suites-${{ matrix.shard }}-"
	notifyCommand = "go run ./cmd/slacknotify"
)

// eventDependent are the expression fragments that would give main a different
// split from a pull request.
var eventDependent = []string{"github.event_name", "github.ref", "needs.changes.outputs"}

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

// MainSuites reports every way a push to main could stop splitting the suites
// like a pull request in a queued run, or stop telling Slack when a shard fails or times out.
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
	problems = append(problems, shardProblems(wf.Jobs["package-suites"])...)
	problems = append(problems, notifyProblems(wf.Jobs)...)

	return problems, nil
}

func shardProblems(job suitesJob) []string {
	problems := matrixProblems(job)
	if !strings.Contains(job.Name, "strategy.job-total") {
		problems = append(problems, "package-suites must name its shard count from strategy.job-total")
	}

	return append(problems, stepProblems(job.Steps)...)
}

// matrixProblems wants a shard list and a timeout that read nothing about the event.
func matrixProblems(job suitesJob) []string {
	shard := mappingValue(job.Strategy.Matrix, "shard")
	if shard == "" {
		shard = sequenceText(job.Strategy.Matrix, "shard")
	}
	if shard == "" {
		return []string{"package-suites must list its shards in strategy.matrix.shard"}
	}
	var problems []string
	for _, fragment := range eventDependent {
		if strings.Contains(shard, fragment) || strings.Contains(job.Timeout.Value, fragment) {
			problems = append(problems, "package-suites must split and time out alike on every event, not by "+fragment)
		}
	}

	return problems
}

func stepProblems(steps []suitesStep) []string {
	var problems []string
	sharded, cached := false, 0
	for _, step := range steps {
		if strings.Contains(step.Env["PACKAGE_SUITES_SHARD"], "strategy.job-total") {
			sharded = true
		}
		if strings.Contains(step.With["restore-keys"], shardCacheKey) && strings.Contains(step.With["key"], shardCacheKey) {
			cached++
			for _, fragment := range eventDependent {
				if strings.Contains(step.With["key"], fragment) || strings.Contains(step.With["restore-keys"], fragment) {
					problems = append(problems, "the suite-result cache must key alike on every event, not by "+fragment)
				}
			}
		}
	}
	if !sharded {
		problems = append(problems, "PACKAGE_SUITES_SHARD must take its total from strategy.job-total")
	}
	if cached != 2 {
		problems = append(problems, fmt.Sprintf("both suite-result caches must key on and fall back to %s, %d do", shardCacheKey, cached))
	}

	return problems
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
		for _, want := range []string{"always()", "refs/heads/main", "needs.package-suites.result == 'failure'", "needs.package-suites.result == 'cancelled'"} {
			if !strings.Contains(job.If, want) {
				problems = append(problems, "the package-suites Slack job's if must include "+want)
			}
		}

		return problems
	}

	return []string{"no job after package-suites runs " + notifyCommand}
}

// sequenceText is key's flow or block sequence in a mapping node, written out
// as one string so a fragment search reads every item.
func sequenceText(node yaml.Node, key string) string {
	if node.Kind != yaml.MappingNode {
		return ""
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value != key || node.Content[i+1].Kind != yaml.SequenceNode {
			continue
		}
		items := make([]string, 0, len(node.Content[i+1].Content))
		for _, item := range node.Content[i+1].Content {
			items = append(items, item.Value)
		}

		return "[" + strings.Join(items, ", ") + "]"
	}

	return ""
}

// mappingValue is key's scalar in a mapping node, "" for any other shape.
func mappingValue(node yaml.Node, key string) string {
	if node.Kind != yaml.MappingNode {
		return ""
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1].Value
		}
	}

	return ""
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

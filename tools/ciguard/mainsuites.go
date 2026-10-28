package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// A push to main runs package-suites as one job, queues behind the run before
// it and posts a red run to Slack. See specs/ci/package-suite-integration-lane.feature.

// AppCIWorkflow is the workflow that runs the package suites.
const AppCIWorkflow = ".github/workflows/langwatch-app-ci.yml"

const (
	oneJobOutput   = "${{ github.event_name == 'push' }}"
	oneJobFlag     = "needs.changes.outputs.suites-one-job == 'true'"
	mainQueues     = "${{ github.event_name != 'push' || github.ref != 'refs/heads/main' }}"
	sharedCacheKey = "nx-suites-all-"
	notifyCommand  = "go run ./cmd/slacknotify"
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
		Matrix map[string]yaml.Node `yaml:"matrix"`
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
	problems = append(problems, notifyProblems(wf.Jobs)...)

	return problems, nil
}

func oneJobProblems(job suitesJob) []string {
	var problems []string
	if shard := job.Strategy.Matrix["shard"]; !strings.Contains(shard.Value, oneJobFlag+" && '[1]'") {
		problems = append(problems, "package-suites must run one shard when suites-one-job is true")
	}
	if !strings.Contains(job.Timeout.Value, oneJobFlag) {
		problems = append(problems, "package-suites must lengthen its timeout when suites-one-job is true")
	}
	if !strings.Contains(job.Name, "strategy.job-total") {
		problems = append(problems, "package-suites must name its shard count from strategy.job-total")
	}
	sharded, cached := false, 0
	for _, step := range job.Steps {
		if strings.Contains(step.Env["PACKAGE_SUITES_SHARD"], "strategy.job-total") {
			sharded = true
		}
		if strings.Contains(step.With["restore-keys"], sharedCacheKey) {
			cached++
		}
	}
	if !sharded {
		problems = append(problems, "PACKAGE_SUITES_SHARD must take its total from strategy.job-total")
	}
	if cached != 2 {
		problems = append(problems, fmt.Sprintf("both suite-result caches must fall back to %s, %d do", sharedCacheKey, cached))
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

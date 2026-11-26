package ciguard

import (
	"fmt"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/upgradelab/seed"
)

// Spec: specs/ci/path-filters.feature

const (
	goCIWorkflow       = ".github/workflows/go-ci.yaml"
	upgradelabKey      = "upgradelab"
	upgradelabOutput   = "steps.filter.outputs.upgradelab"
	upgradelabTestRun  = "go test ./tools/upgradelab/..."
	upgradelabWhenSet  = "needs.changes.outputs.upgradelab == 'true'"
	upgradelabSkipFull = "!(needs.changes.outputs.go == 'true' && needs.changes.outputs.heavy == 'true')"
)

// UpgradelabTrigger checks that a pull request declaring a migration step runs upgradelab's
// coverage test: go-ci starts on every step-declaring path, its changes job filters and outputs
// them under `upgradelab`, and the upgradelab job runs the tests unless the full test job does.
func UpgradelabTrigger(root string) ([]string, error) {
	workflow, err := ciscan.Load(root, goCIWorkflow)
	if err != nil {
		return nil, err
	}
	changes := workflow.Jobs["changes"]
	filter, err := upgradelabFilter(changes)
	if err != nil {
		return nil, err
	}
	problems := missingGlobs(workflow.On.PullRequest.Paths, "on.pull_request.paths", "a pull request declaring a step there starts no run")
	problems = append(problems, missingGlobs(filter, "the upgradelab filter", "the coverage test skips on it")...)
	if !strings.Contains(changes.Outputs[upgradelabKey], upgradelabOutput) {
		problems = append(problems, fmt.Sprintf("%s: the changes job must output upgradelab from %s", goCIWorkflow, upgradelabOutput))
	}
	return append(problems, upgradelabJobProblems(workflow.Jobs[upgradelabKey])...), nil
}

// upgradelabFilter is the `upgradelab` key of the changes job's paths filter.
func upgradelabFilter(changes ciscan.Job) ([]string, error) {
	for i := range changes.Steps {
		step := &changes.Steps[i]
		raw, ok := step.StringWith("filters")
		if step.ID != "filter" || !ok {
			continue
		}
		var filters map[string][]string
		if err := yaml.Unmarshal([]byte(raw), &filters); err != nil {
			return nil, fmt.Errorf("parse %s filters: %w", goCIWorkflow, err)
		}
		return filters[upgradelabKey], nil
	}
	return nil, nil
}

// missingGlobs names each step-declaring glob the list leaves out.
func missingGlobs(list []string, where, consequence string) []string {
	var problems []string
	for _, glob := range seed.StepDeclarationGlobs {
		if !slices.Contains(list, glob) {
			problems = append(problems, fmt.Sprintf("%s: %s misses %s, so %s", goCIWorkflow, where, glob, consequence))
		}
	}
	return problems
}

// upgradelabJobProblems reports an upgradelab job that skips when the full test job does not
// run, or that no longer runs the upgradelab tests.
func upgradelabJobProblems(job ciscan.Job) []string {
	var problems []string
	if !strings.Contains(job.If, upgradelabWhenSet) || !strings.Contains(job.If, upgradelabSkipFull) {
		problems = append(problems, fmt.Sprintf("%s: the upgradelab job's if must require both %s and %s", goCIWorkflow, upgradelabWhenSet, upgradelabSkipFull))
	}
	runs := slices.ContainsFunc(job.Steps, func(step ciscan.Step) bool { return step.Run == upgradelabTestRun })
	if !runs {
		problems = append(problems, fmt.Sprintf("%s: the upgradelab job must run %s", goCIWorkflow, upgradelabTestRun))
	}
	return problems
}

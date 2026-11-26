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
	goCIWorkflow      = ".github/workflows/go-ci.yaml"
	upgradelabKey     = "upgradelab"
	upgradelabOutput  = "steps.filter.outputs.upgradelab || steps.force.outputs.go"
	upgradelabTestRun = "go test -count=1 ./tools/upgradelab/..."
	upgradelabWhenSet = "needs.changes.outputs.upgradelab == 'true'"
)

// UpgradelabTrigger checks that a pull request declaring a migration step runs upgradelab's
// coverage test: go-ci's changes job filters and outputs every step-declaring path under
// `upgradelab`, and the upgradelab job runs the tests unless the full test job runs.
// The path-filter guard's R1 already holds on.pull_request.paths to that filter.
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
	problems := missingGlobs(filter)
	if output := changes.Outputs[upgradelabKey]; !strings.HasPrefix(strings.TrimSpace(output), "${{") || expressionBody(output) != upgradelabOutput {
		problems = append(problems, fmt.Sprintf("%s: the changes job must output upgradelab as ${{ %s }}", goCIWorkflow, upgradelabOutput))
	}
	return append(problems, upgradelabJobProblems(workflow.Jobs[upgradelabKey], workflow.Jobs["test"])...), nil
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

// missingGlobs names each step-declaring glob the upgradelab filter leaves out.
func missingGlobs(filter []string) []string {
	var problems []string
	for _, glob := range seed.StepDeclarationGlobs {
		if !slices.Contains(filter, glob) {
			problems = append(problems, fmt.Sprintf("%s: the upgradelab filter misses %s, so the coverage test skips on it", goCIWorkflow, glob))
		}
	}
	return problems
}

// upgradelabJobProblems reports an upgradelab job that skips when the full test job does not
// run (its if must be exactly "upgradelab matched and not the test job's own gate"), or that no
// longer runs the upgradelab tests.
func upgradelabJobProblems(job, test ciscan.Job) []string {
	var problems []string
	want := upgradelabWhenSet + " && !(" + expressionBody(test.If) + ")"
	if expressionBody(job.If) != want {
		problems = append(problems, fmt.Sprintf("%s: the upgradelab job's if must be %s", goCIWorkflow, want))
	}
	runs := slices.ContainsFunc(job.Steps, func(step ciscan.Step) bool { return step.Run == upgradelabTestRun && step.If == "" })
	if !runs {
		problems = append(problems, fmt.Sprintf("%s: the upgradelab job must run %s in a step with no if of its own", goCIWorkflow, upgradelabTestRun))
	}
	return problems
}

// expressionBody is a job `if:` without its `${{ }}` wrapper.
func expressionBody(condition string) string {
	body := strings.TrimSpace(condition)
	body = strings.TrimSuffix(strings.TrimPrefix(body, "${{"), "}}")
	return strings.TrimSpace(body)
}

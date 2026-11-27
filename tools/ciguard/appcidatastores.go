package ciguard

import (
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// Spec: specs/ci/app-ci-datastores.feature

// AppCIWorkflows are the workflows that run the app's suites against datastores.
var AppCIWorkflows = []string{
	".github/workflows/langwatch-app-ci.yml",
	".github/workflows/e2e-ci.yml",
}

// waitContainersCommand holds a step until the containers it names are healthy.
const waitContainersCommand = "go run ./cmd/waitcontainers"

// afterFailure matches an `if:` that runs a step once an earlier step failed or the job was cancelled.
var afterFailure = regexp.MustCompile(`\b(always|failure)\(\)`)

// AppCIDatastores reports a `services:` block in the app CI workflows (the runner pulls and
// health-waits its containers before the first step, and stops them after the last with no
// timeout a workflow can set), and a step running after a failure, or waiting for containers,
// without its own timeout-minutes.
func AppCIDatastores(root string) ([]string, error) {
	var problems []string
	for _, path := range AppCIWorkflows {
		workflow, err := ciscan.Load(root, path)
		if err != nil {
			return nil, err
		}
		for _, name := range workflow.JobNames() {
			problems = append(problems, appCIJobProblems(path, name, workflow.Jobs[name])...)
		}
	}

	return problems, nil
}

// appCIJobProblems checks one job of an app CI workflow.
func appCIJobProblems(path, name string, job ciscan.Job) []string {
	where := fmt.Sprintf("%s job %q", path, name)
	var problems []string
	if len(job.Services) > 0 {
		names := make([]string, 0, len(job.Services))
		for service := range job.Services {
			names = append(names, service)
		}
		slices.Sort(names)
		problems = append(problems, fmt.Sprintf(
			"%s declares services: %s; start them with docker run in the background and wait with %s",
			where, strings.Join(names, ", "), waitContainersCommand))
	}
	for i := range job.Steps {
		if label, unbounded := unboundedStep(&job.Steps[i]); unbounded {
			problems = append(problems, fmt.Sprintf("%s: step %q needs its own timeout-minutes", where, label))
		}
	}

	return problems
}

// unboundedStep reports a step that runs after a failure, or waits for containers, with no
// timeout-minutes of its own, so a hang there holds the job until the job's own timeout.
func unboundedStep(step *ciscan.Step) (string, bool) {
	bounded := step.TimeoutMinutes != nil
	needsBound := afterFailure.MatchString(step.If) || strings.Contains(step.Run, waitContainersCommand)
	if bounded || !needsBound {
		return "", false
	}
	if step.Name != "" {
		return step.Name, true
	}

	return step.Uses, true
}

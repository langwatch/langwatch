package ecrtag

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// BuildSteps is how the workflow builds its images: the job, action and
// with: of every docker/build-push-action step that pushes, in a stable
// order. Every image's hash takes it, so a new build argument, platform or
// output rebuilds without a bump of inputsVersion. An edit to one build job
// rebuilds the other job's images too, which errs towards building.
func BuildSteps(repoRoot, workflow string) (string, error) {
	wf, err := ciscan.Load(repoRoot, workflow)
	if err != nil {
		return "", err
	}
	type buildStep struct {
		Job  string         `json:"job"`
		Uses string         `json:"uses"`
		With map[string]any `json:"with"`
	}
	var steps []buildStep
	for _, job := range wf.JobNames() {
		for i := range wf.Jobs[job].Steps {
			step := &wf.Jobs[job].Steps[i]
			if push, _ := step.BoolWith("push"); push && strings.HasPrefix(step.Uses, "docker/build-push-action@") {
				steps = append(steps, buildStep{Job: job, Uses: step.Uses, With: step.With})
			}
		}
	}
	if len(steps) == 0 {
		return "", fmt.Errorf("%s has no docker/build-push-action step that pushes", workflow)
	}
	slices.SortStableFunc(steps, func(a, b buildStep) int { return strings.Compare(a.Job, b.Job) })
	out, err := json.Marshal(steps)

	return string(out), err
}

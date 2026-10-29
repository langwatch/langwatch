package ciguard

import (
	"fmt"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// PrivateImagesWorkflow builds one image from any ref into the artifacts ECR.
const PrivateImagesWorkflow = ".github/workflows/publish-docker-private.yml"

const (
	ecrtagPublished = "go run ./cmd/ecrtag published"
	ecrtagLambda    = "go run ./cmd/ecrtag lambda"
	skipGate        = "steps.exists.outputs.exists != 'true'"
)

// ECRSkipGates reports every way a publish to the artifacts ECR, whose tags
// are immutable, could push a tag without asking cmd/ecrtag first: a pushing
// build with no existence check before it or no gate on its answer, an
// ecrtag call that does not say whether the tag is custom, and a Lambda
// check that would refuse the ancestor image a push run re-tagged.
// See specs/ci/publish-ecr-images.feature.
func ECRSkipGates(repoRoot string) ([]string, error) {
	var problems []string
	for _, rel := range []string{ImagesWorkflow, PrivateImagesWorkflow} {
		wf, err := ciscan.Load(repoRoot, rel)
		if err != nil {
			return nil, err
		}
		for _, name := range wf.JobNames() {
			problems = append(problems, jobSkipGates(rel, name, wf.Jobs[name])...)
		}
		if rel == ImagesWorkflow {
			problems = append(problems, imagesPublishCalls(wf)...)
		}
	}

	return problems, nil
}

func jobSkipGates(rel, job string, j ciscan.Job) []string {
	var problems []string
	checked := false
	for i := range j.Steps {
		step := &j.Steps[i]
		if strings.Contains(step.Run, "cmd/ecrtag") && !strings.Contains(step.Run, "-custom=") {
			problems = append(problems, fmt.Sprintf("%s job %s: step %q calls cmd/ecrtag without -custom=", rel, job, step.Name))
		}
		checked = checked || (step.ID == "exists" && strings.Contains(step.Run, ecrtagPublished))
		if ungated(step, checked) {
			problems = append(problems, fmt.Sprintf("%s job %s: %q pushes without an earlier `id: exists` step running %q and `if: %s`", rel, job, step.Name, ecrtagPublished, skipGate))
		}
	}

	return problems
}

// ungated is a pushing build that no existence check, or no gate on its
// answer, stands in front of.
func ungated(step *ciscan.Step, checked bool) bool {
	pushes := strings.HasPrefix(step.Uses, "docker/build-push-action@") && step.With["push"] == true

	return pushes && (!checked || !strings.Contains(step.If, skipGate))
}

// imagesPublishCalls: the tags create-manifest writes go through cmd/ecrtag,
// and a Lambda build accepts the image a push run re-tagged.
func imagesPublishCalls(wf *ciscan.Workflow) []string {
	var problems []string
	if !jobRuns(wf.Jobs["create-manifest"], ecrtagPublished+" ", "-source annotation") || !jobRuns(wf.Jobs["create-manifest"], ecrtagLambda+" ") {
		problems = append(problems, ImagesWorkflow+" job create-manifest must check each index tag with `"+ecrtagPublished+" ... -source annotation` and publish each Lambda tag with `"+ecrtagLambda+"`")
	}
	if !jobRuns(wf.Jobs["build-and-push-lambda"], ecrtagPublished+" ", "-accept-retag") {
		problems = append(problems, ImagesWorkflow+" job build-and-push-lambda must check with -accept-retag, or a dispatch fails on a tag a push run re-tagged")
	}

	return problems
}

func jobRuns(j ciscan.Job, fragments ...string) bool {
	for i := range j.Steps {
		if containsAll(j.Steps[i].Run, fragments) {
			return true
		}
	}

	return false
}

func containsAll(s string, fragments []string) bool {
	for _, f := range fragments {
		if !strings.Contains(s, f) {
			return false
		}
	}

	return true
}

package ciguard

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// PrivateImagesWorkflow builds one image from any ref into the artifacts ECR.
const PrivateImagesWorkflow = ".github/workflows/publish-docker-private.yml"

const (
	ecrtagPublished = "go run ./cmd/ecrtag published"
	ecrtagLambda    = "go run ./cmd/ecrtag lambda"
	skipGate        = "steps.exists.outputs.exists != 'true'"
	// manifestJob writes the index and Lambda tags itself, behind ecrtag
	// calls inside its loop (imagesPublishCalls).
	manifestJob = "create-manifest"
)

// shellPush is a registry write from a run step, function bodies included.
var shellPush = regexp.MustCompile(`\bdocker\s+push\b|\bbuildx\s+build\b[^\n]*\s--push\b|\bimagetools\s+create\b|\bput-image\b`)

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
	exempt := rel == ImagesWorkflow && job == manifestJob
	for i := range j.Steps {
		step := &j.Steps[i]
		problems = append(problems, customProblems(rel, job, step)...)
		checked = checked || (step.ID == "exists" && strings.Contains(step.Run, ecrtagPublished))
		if pushes(step, exempt) && (!checked || !gated(step.If)) {
			problems = append(problems, fmt.Sprintf("%s job %s: %q pushes without an earlier `id: exists` step running %q and %#q as a top-level && term of its if:", rel, job, step.Name, ecrtagPublished, skipGate))
		}
	}

	return problems
}

func customProblems(rel, job string, step *ciscan.Step) []string {
	if strings.Contains(step.Run, "cmd/ecrtag") && !strings.Contains(step.Run, "-custom=") {
		return []string{fmt.Sprintf("%s job %s: step %q calls cmd/ecrtag without -custom=", rel, job, step.Name)}
	}

	return nil
}

// pushes is a build whose push: is anything but literally false, or a run
// step that writes to a registry outside the manifest job.
func pushes(step *ciscan.Step, exempt bool) bool {
	if strings.HasPrefix(step.Uses, "docker/build-push-action@") {
		push, ok := step.With["push"]
		return ok && push != false && push != "false"
	}
	run := strings.ReplaceAll(step.Run, "\\\n", " ")

	return !exempt && shellPush.MatchString(run)
}

// gated holds when the skip gate is one of the top-level && terms of if:, so
// an `||` cannot dilute it.
func gated(cond string) bool {
	cond = strings.TrimSpace(cond)
	if strings.HasPrefix(cond, "${{") && strings.HasSuffix(cond, "}}") {
		cond = strings.TrimSpace(cond[3 : len(cond)-2])
	}
	for _, term := range topLevelAnd(cond) {
		if strings.TrimSpace(term) == skipGate {
			return true
		}
	}

	return false
}

// topLevelAnd splits an expression on && outside parentheses and quotes; a
// term holding a top-level || stays whole and so never equals the gate.
func topLevelAnd(expr string) []string {
	var terms []string
	depth, quoted, start := 0, false, 0
	for i := 0; i < len(expr); i++ {
		switch c := expr[i]; {
		case c == '\'':
			quoted = !quoted
		case quoted:
		case c == '(':
			depth++
		case c == ')':
			depth--
		case depth == 0 && strings.HasPrefix(expr[i:], "&&"):
			terms = append(terms, expr[start:i])
			start, i = i+2, i+1
		}
	}

	return append(terms, expr[start:])
}

// imagesPublishCalls: the tags create-manifest writes go through cmd/ecrtag,
// and a Lambda build accepts the image a push run re-tagged.
func imagesPublishCalls(wf *ciscan.Workflow) []string {
	var problems []string
	if !jobRuns(wf.Jobs[manifestJob], ecrtagPublished+" ", "-source annotation") || !jobRuns(wf.Jobs[manifestJob], ecrtagLambda+" ") {
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

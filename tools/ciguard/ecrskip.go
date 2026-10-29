package ciguard

import (
	"fmt"
	"regexp"
	"slices"
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
var shellPush = regexp.MustCompile(`\bdocker\s+push\b|\s--push\b|(?:\s-o|--output)[\s=]\S*type=registry|\bimagetools\s+create\b|\bput-image\b|\bcrane\s|\bskopeo\s|\boras\s`)

// ecrtagArg is one quoted "${VAR}" argument of an ecrtag call.
var ecrtagArg = regexp.MustCompile(`-(repository|tag)\s+"\$\{(\w+)\}"`)

// The only values the -custom and -retag flags may be handed.
var (
	customSources = []string{"${{ needs.meta.outputs.custom_tag }}", "${{ steps.meta.outputs.custom_tag }}"}
	retagByEvent  = "${{ github.event_name == 'push' && 'accept' || 'refuse' }}"
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
	exempt := rel == ImagesWorkflow && job == manifestJob
	var check *ciscan.Step
	for i := range j.Steps {
		step := &j.Steps[i]
		problems = append(problems, customProblems(rel, job, step)...)
		if check == nil && step.ID == "exists" && strings.Contains(step.Run, ecrtagPublished) {
			check = step
		}
		if pushes(step, exempt) {
			problems = append(problems, pushProblems(rel+" job "+job, check, step)...)
		}
	}

	return problems
}

func pushProblems(where string, check, step *ciscan.Step) []string {
	if check == nil || !gated(step.If) {
		return []string{fmt.Sprintf("%s: %q pushes without an earlier `id: exists` step running %q and %#q as a top-level && term of its if:", where, step.Name, ecrtagPublished, skipGate)}
	}
	if step.Run != "" {
		return nil
	}
	if want := checkedImage(check); want == "" || !strings.Contains(fmt.Sprint(step.With["tags"]), "/"+want) {
		return []string{fmt.Sprintf("%s: %q pushes tags %v, not the %q its exists step checked", where, step.Name, step.With["tags"], want)}
	}

	return nil
}

// checkedImage is the "<repository>:<tag>" an exists step checks, written as
// the expressions a build's tags: would use.
func checkedImage(check *ciscan.Step) string {
	args := map[string]string{}
	for _, m := range ecrtagArg.FindAllStringSubmatch(check.Run, -1) {
		value, ok := check.Env[m[2]]
		if !ok {
			value = "${{ env." + m[2] + " }}"
		}
		args[m[1]] = value
	}
	if args["repository"] == "" || args["tag"] == "" {
		return ""
	}

	return args["repository"] + ":" + args["tag"]
}

// customProblems: every ecrtag call says whether the tag is custom, from the
// meta step's own answer.
func customProblems(rel, job string, step *ciscan.Step) []string {
	if !strings.Contains(step.Run, "go run ./cmd/ecrtag") {
		return nil
	}
	if !strings.Contains(step.Run, `-custom="${CUSTOM_TAG}"`) || !slices.Contains(customSources, step.Env["CUSTOM_TAG"]) {
		return []string{fmt.Sprintf("%s job %s: step %q must pass -custom=\"${CUSTOM_TAG}\" with CUSTOM_TAG set to the meta step's custom_tag", rel, job, step.Name)}
	}

	return nil
}

// pushes is a build whose push: is anything but the boolean or string false,
// or whose outputs go to a registry, or a run step that writes to a registry
// outside the manifest job.
func pushes(step *ciscan.Step, exempt bool) bool {
	if strings.HasPrefix(step.Uses, "docker/build-push-action@") {
		push, ok := step.With["push"]
		output := fmt.Sprint(step.With["outputs"], step.With["output"])

		return (ok && push != false && push != "false") || strings.Contains(output, "type=registry")
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
	if !jobRuns(wf.Jobs[manifestJob], ecrtagPublished+" ", `-built-from "${IMAGE_TAG}-arm64"`) {
		problems = append(problems, ImagesWorkflow+" job create-manifest must pass -built-from \"${IMAGE_TAG}-arm64\", or an index a push run re-tagged passes for a rebuilt image")
	}
	if !jobHasStep(wf.Jobs["build-and-push-lambda"], retagsByEvent) {
		problems = append(problems, ImagesWorkflow+" job build-and-push-lambda must check with -retag=\"${RETAG}\" and RETAG: "+retagByEvent+": a push run's re-run accepts its own re-tag, a dispatch refuses it")
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

func retagsByEvent(step *ciscan.Step) bool {
	return strings.Contains(step.Run, ecrtagPublished) && strings.Contains(step.Run, `-retag="${RETAG}"`) && step.Env["RETAG"] == retagByEvent
}

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
	// registryHost is how a build's tags: names the registry.
	registryHost = "${{ steps.ecr.outputs.registry }}"
	// customFlag is the one -custom an ecrtag call may pass.
	customFlag = `-custom="${CUSTOM_TAG}"`
	// builtFrom is create-manifest's -built-from for a rebuilt image, passed
	// through fromArgs so an image it did not build passes none.
	builtFrom = `from=(-built-from "${IMAGE_TAG}-arm64")`
	fromArgs  = `"${from[@]}"`
)

// shellPush is a registry write from a run step, function bodies included,
// other than an index write (indexWrite), which create-manifest may make.
var shellPush = regexp.MustCompile(`\b(?:docker|podman|buildah)\s+(?:image\s+|manifest\s+)?push\b|\s--push\b|(?:\s-o|--output)[\s=]\S*(?:type=registry|push=true)|\bput-image\b|\bcrane\s|\bskopeo\s|\boras\s`)

var indexWrite = regexp.MustCompile(`\bimagetools\s+create\b`)

// registryOutput is a build-push-action outputs: that writes to a registry.
var registryOutput = regexp.MustCompile(`type=registry|(?:^|[^\w-])push=true\b`)

// ecrtagArg is one quoted "${VAR}" argument of an ecrtag call.
var ecrtagArg = regexp.MustCompile(`-(repository|tag)\s+"\$\{(\w+)\}"`)

// ecrtagCall is one cmd/ecrtag call, its continuation lines joined; ecrtagFlag
// is one flag it passes, and refuseRetag the bare -refuse-retag.
var (
	ecrtagCall  = regexp.MustCompile(`go run \./cmd/ecrtag\s[^\n]*`)
	ecrtagFlag  = regexp.MustCompile(`(?:^|\s)--?([a-z][\w-]*)`)
	refuseRetag = regexp.MustCompile(`\s-refuse-retag(?:\s|\)|$)`)
)

// The only values the -custom flag may be handed.
var customSources = []string{"${{ needs.meta.outputs.custom_tag }}", "${{ steps.meta.outputs.custom_tag }}"}

// ECRSkipGates reports every way a publish to the artifacts ECR, whose tags
// are immutable, could push a tag without asking cmd/ecrtag first: a pushing
// build with no existence check before it or no gate on its answer, a build
// pushing other tags than the one checked, an ecrtag call that does not say
// whether the tag is custom or passes a flag twice, and a Lambda check that
// would count a push run's re-tag as this run's build.
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
	if where == ImagesWorkflow+" job "+manifestJob {
		return []string{fmt.Sprintf("%s: %q writes to the registry with something other than `imagetools create` and %#q, the only writes behind its ecrtag checks", where, step.Name, ecrtagLambda)}
	}
	if check == nil || !gated(step.If) {
		return []string{fmt.Sprintf("%s: %q pushes without an earlier `id: exists` step running %q and %#q as a top-level && term of its if:", where, step.Name, ecrtagPublished, skipGate)}
	}
	if step.Run != "" {
		return nil
	}
	if want := checkedImage(check); want == "" || !slices.Equal(tagList(step.With["tags"]), []string{registryHost + "/" + want}) {
		return []string{fmt.Sprintf("%s: %q pushes tags %v, not exactly the %q its exists step checked", where, step.Name, step.With["tags"], want)}
	}

	return nil
}

// tagList is a build's tags:, one entry per line or comma.
func tagList(tags any) []string {
	var list []string
	for _, tag := range strings.FieldsFunc(fmt.Sprint(tags), func(r rune) bool { return r == '\n' || r == ',' }) {
		if tag = strings.TrimSpace(tag); tag != "" {
			list = append(list, tag)
		}
	}

	return list
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
// meta step's own answer, and passes no flag twice (the last one would win).
func customProblems(rel, job string, step *ciscan.Step) []string {
	var problems []string
	for _, call := range ecrtagCalls(step.Run) {
		if !strings.Contains(call, customFlag) || !slices.Contains(customSources, step.Env["CUSTOM_TAG"]) {
			problems = append(problems, fmt.Sprintf("%s job %s: step %q must pass %s with CUSTOM_TAG set to the meta step's custom_tag", rel, job, step.Name, customFlag))
		}
		if flag := repeatedFlag(call); flag != "" {
			problems = append(problems, fmt.Sprintf("%s job %s: step %q passes -%s more than once to %#q; only the last one counts", rel, job, step.Name, flag, call))
		}
	}

	return problems
}

func ecrtagCalls(run string) []string {
	return ecrtagCall.FindAllString(strings.ReplaceAll(run, "\\\n", " "), -1)
}

// repeatedFlag is a flag a call passes twice, "${from[@]}" counting as
// -built-from, or "".
func repeatedFlag(call string) string {
	flags := []string{}
	for range strings.Count(call, fromArgs) {
		flags = append(flags, "built-from")
	}
	for _, m := range ecrtagFlag.FindAllStringSubmatch(call, -1) {
		if slices.Contains(flags, m[1]) {
			return m[1]
		}
		flags = append(flags, m[1])
	}
	if strings.Count(call, fromArgs) > 1 {
		return "built-from"
	}

	return ""
}

// pushes is a build whose push: is anything but the boolean or string false,
// or whose outputs go to a registry, or a run step that writes to a registry
// outside the manifest job.
func pushes(step *ciscan.Step, exempt bool) bool {
	if strings.HasPrefix(step.Uses, "docker/build-push-action@") {
		push, ok := step.With["push"]
		output := fmt.Sprint(step.With["outputs"], " ", step.With["output"])

		return (ok && push != false && push != "false") || registryOutput.MatchString(output)
	}
	run := strings.ReplaceAll(step.Run, "\\\n", " ")

	return shellPush.MatchString(run) || (!exempt && indexWrite.MatchString(run))
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
// its index check of a rebuilt image names the build, and a Lambda build
// refuses the image a push run re-tagged.
func imagesPublishCalls(wf *ciscan.Workflow) []string {
	var problems []string
	if !jobRuns(wf.Jobs[manifestJob], ecrtagPublished+" ", "-source annotation") || !jobRuns(wf.Jobs[manifestJob], ecrtagLambda+" ") {
		problems = append(problems, ImagesWorkflow+" job create-manifest must check each index tag with `"+ecrtagPublished+" ... -source annotation` and publish each Lambda tag with `"+ecrtagLambda+"`")
	}
	if !jobHasStep(wf.Jobs[manifestJob], passesBuiltFrom) {
		problems = append(problems, ImagesWorkflow+" job create-manifest must set "+builtFrom+" for a rebuilt image and pass "+fromArgs+" on its `"+ecrtagPublished+"` call, or an index a push run re-tagged passes for a rebuilt image")
	}
	if !jobHasStep(wf.Jobs["build-and-push-lambda"], refusesRetag) {
		problems = append(problems, ImagesWorkflow+" job build-and-push-lambda must check with `"+ecrtagPublished+" ... -refuse-retag`: a tag a push run re-tagged cannot be moved to this build")
	}

	return problems
}

func passesBuiltFrom(step *ciscan.Step) bool {
	return strings.Contains(step.Run, builtFrom) && callPasses(step, fromArgs)
}

func refusesRetag(step *ciscan.Step) bool {
	return step.ID == "exists" && slices.ContainsFunc(ecrtagCalls(step.Run), func(call string) bool {
		return strings.HasPrefix(call, ecrtagPublished+" ") && refuseRetag.MatchString(call)
	})
}

// callPasses holds when one of the step's `ecrtag published` calls passes arg.
func callPasses(step *ciscan.Step, arg string) bool {
	return slices.ContainsFunc(ecrtagCalls(step.Run), func(call string) bool {
		return strings.HasPrefix(call, ecrtagPublished+" ") && strings.Contains(call, arg)
	})
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

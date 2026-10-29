package ciguard

import (
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

const (
	changesJob    = "changes"
	ecrtagDiff    = "go run ./cmd/ecrtag diffbase"
	diffBaseSHA   = "${{ steps.base.outputs.sha }}"
	diffBaseGate  = "steps.base.outputs.sha != ''"
	diffBaseInput = `-repositories "${REPOSITORIES}"`
)

// manifestLoop is the list of images create-manifest tags, one per pass.
var manifestLoop = regexp.MustCompile(`for IMAGE in ([^;]*); do`)

// ECRDiffBase reports a publish-docker-ecr.yml whose change set could start
// anywhere but the commit a re-tag copies: a path filter with no base, or one
// not from cmd/ecrtag diffbase, or diffbase asking about other images than
// create-manifest tags. Without it a push diffs the previous push, and a
// replaced run's change is re-tagged away. See specs/ci/publish-ecr-images.feature.
func ECRDiffBase(repoRoot string) ([]string, error) {
	wf, err := ciscan.Load(repoRoot, ImagesWorkflow)
	if err != nil {
		return nil, err
	}
	base, filter := diffBaseSteps(wf.Jobs[changesJob])
	if base == nil {
		return []string{fmt.Sprintf("%s job %s needs an `id: base` step running %#q with %s", ImagesWorkflow, changesJob, ecrtagDiff, diffBaseInput)}, nil
	}
	var problems []string
	if filter == nil || fmt.Sprint(filter.With["base"]) != diffBaseSHA || strings.TrimSpace(filter.If) != diffBaseGate {
		problems = append(problems, fmt.Sprintf("%s job %s: the paths filter must run with `base: %s` and `if: %s`; with no base a push diffs the previous push, which misses a replaced run's commits", ImagesWorkflow, changesJob, diffBaseSHA, diffBaseGate))
	}
	asked := strings.Fields(base.Env["REPOSITORIES"])
	tagged := manifestImages(wf.Jobs[manifestJob])
	slices.Sort(asked)
	slices.Sort(tagged)
	if len(tagged) == 0 || !slices.Equal(asked, tagged) {
		problems = append(problems, fmt.Sprintf("%s job %s: the base step's REPOSITORIES %v must be exactly the images create-manifest re-tags %v", ImagesWorkflow, changesJob, asked, tagged))
	}

	return problems, nil
}

// diffBaseSteps is the changes job's diffbase step and its paths filter.
func diffBaseSteps(j ciscan.Job) (base, filter *ciscan.Step) {
	for i := range j.Steps {
		step := &j.Steps[i]
		if step.ID == "base" && strings.Contains(step.Run, ecrtagDiff+" ") && strings.Contains(step.Run, diffBaseInput) {
			base = step
		}
		if strings.HasPrefix(step.Uses, "dorny/paths-filter@") {
			filter = step
		}
	}

	return base, filter
}

func manifestImages(j ciscan.Job) []string {
	for i := range j.Steps {
		run := strings.ReplaceAll(j.Steps[i].Run, "\\\n", " ")
		if m := manifestLoop.FindStringSubmatch(run); m != nil {
			return strings.Fields(m[1])
		}
	}

	return nil
}

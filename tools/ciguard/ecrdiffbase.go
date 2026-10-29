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
	// The select step builds from the filter only with a base, and adds every
	// image diffbase says the diff cannot speak for.
	filteredWhen   = "${{ steps.base.outputs.sha != '' }}"
	rebuildOutput  = "${{ steps.base.outputs.rebuild }}"
	rebuildWritten = `echo "rebuild=${REBUILD}"`
	rebuildRead    = `REBUILD=$(printf '%s' "${BASE}" | jq -c '.rebuild')`
	rebuildArg     = `--argjson rebuild "${REBUILD}"`
	rebuildAdded   = "+ $rebuild | unique"
	filteredIf     = `if [ "${FILTERED}" = "true" ]; then`
	filteredElse   = "else"
)

// manifestLoop is the list of images create-manifest tags, one per pass.
var manifestLoop = regexp.MustCompile(`for IMAGE in ([^;]*); do`)

// ECRDiffBase reports a publish-docker-ecr.yml whose change set could start
// anywhere but the commit a re-tag copies (a filter with no base, or one not
// from cmd/ecrtag diffbase, asking about other images than create-manifest
// tags), or whose selection drops diffbase's forced rebuilds or its gate.
// See specs/ci/publish-ecr-images.feature.
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
	problems = append(problems, selectProblems(base, wf.Jobs[changesJob])...)
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

// selectProblems: the select step filters only when there is a base, and adds
// every image diffbase forces, so a revert hidden by the diff still rebuilds.
func selectProblems(base *ciscan.Step, j ciscan.Job) []string {
	var problems []string
	if !hasLine(base.Run, rebuildRead) || !strings.Contains(base.Run, rebuildWritten) {
		problems = append(problems, fmt.Sprintf("%s job %s: the base step must read diffbase's rebuild list (%s) and write it as an output (%s)", ImagesWorkflow, changesJob, rebuildRead, rebuildWritten))
	}
	var sel *ciscan.Step
	for i := range j.Steps {
		if j.Steps[i].ID == "select" {
			sel = &j.Steps[i]
		}
	}
	if sel == nil || strings.TrimSpace(sel.Env["FILTERED"]) != filteredWhen {
		problems = append(problems, fmt.Sprintf("%s job %s: the select step must set FILTERED: %s; any other gate either filters with no base or builds nothing", ImagesWorkflow, changesJob, filteredWhen))
	}
	if sel == nil || strings.TrimSpace(sel.Env["REBUILD"]) != rebuildOutput || !containsAll(filteredBranch(sel.Run), []string{rebuildArg, rebuildAdded}) {
		problems = append(problems, fmt.Sprintf("%s job %s: the select step must take REBUILD: %s and add it to the filter's images (%s ... %s) in the branch %#q selects", ImagesWorkflow, changesJob, rebuildOutput, rebuildArg, rebuildAdded, filteredIf))
	}

	return problems
}

// filteredBranch is the select script between `if FILTERED` and its `else`.
func filteredBranch(run string) string {
	start := strings.Index(run, filteredIf)
	if start < 0 {
		return ""
	}
	branch := run[start+len(filteredIf):]
	if end := strings.Index(branch, "\n"+filteredElse+"\n"); end >= 0 {
		return branch[:end]
	}

	return ""
}

// hasLine holds when one of run's lines, trimmed, is exactly line.
func hasLine(run, line string) bool {
	return slices.ContainsFunc(strings.Split(run, "\n"), func(l string) bool { return strings.TrimSpace(l) == line })
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

package ciguard

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/ecrtag"
)

const (
	changesJob   = "changes"
	ecrtagSelect = "go run ./cmd/ecrtag select"
	selectImages = `-images "${IMAGES}"`
	inputsLabel  = ecrtag.InputsKey + "=${{ matrix.inputs }}"
)

// buildJobs push the images the select step plans to build.
var buildJobs = []string{"build-and-push", "build-and-push-lambda"}

var (
	// manifestLoop is the list of images create-manifest tags, one per pass.
	manifestLoop = regexp.MustCompile(`for IMAGE in ([^;]*); do`)
	// tableRow is one row of the select step's build tables.
	tableRow = regexp.MustCompile(`\{"image":\s*"([^"]+)",\s*"dockerfile":\s*"([^"]+)"`)
)

// ECRInputs reports a publish-docker-ecr.yml that could re-tag an image whose
// inputs changed: a select step not planned by cmd/ecrtag select, a build
// table that is not exactly the images create-manifest tags, or a build that
// does not record its inputs. See specs/ci/publish-ecr-images.feature.
func ECRInputs(repoRoot string) ([]string, error) {
	wf, err := ciscan.Load(repoRoot, ImagesWorkflow)
	if err != nil {
		return nil, err
	}
	sel, problems := selectStep(wf)
	if sel == nil {
		return problems, nil
	}
	var planned []string
	for _, row := range tableRow.FindAllStringSubmatch(sel.Run, -1) {
		planned = append(planned, row[1])
	}
	tagged := manifestImages(wf.Jobs[manifestJob])
	slices.Sort(planned)
	slices.Sort(tagged)
	if len(tagged) == 0 || !slices.Equal(planned, tagged) {
		problems = append(problems, fmt.Sprintf("%s job %s: the build tables %v must be exactly the images create-manifest tags %v", ImagesWorkflow, changesJob, planned, tagged))
	}

	return append(problems, labelProblems(wf)...), nil
}

// ECRInputsReadable reports an image whose inputs this checkout cannot read,
// as the select step reads them: that image would be rebuilt on every commit.
func ECRInputsReadable(repoRoot string) ([]string, error) {
	wf, err := ciscan.Load(repoRoot, ImagesWorkflow)
	if err != nil {
		return nil, err
	}
	sel, problems := selectStep(wf)
	if sel == nil {
		return problems, nil
	}

	return inputsProblems(repoRoot, tableRow.FindAllStringSubmatch(sel.Run, -1)), nil
}

func selectStep(wf *ciscan.Workflow) (*ciscan.Step, []string) {
	steps := wf.Jobs[changesJob].Steps
	for i := range steps {
		step := &steps[i]
		if step.ID == "select" && strings.Contains(step.Run, ecrtagSelect+" ") && strings.Contains(step.Run, selectImages) {
			return step, nil
		}
	}

	return nil, []string{fmt.Sprintf("%s job %s needs an `id: select` step running %#q with %s", ImagesWorkflow, changesJob, ecrtagSelect, selectImages)}
}

// labelProblems: every build records its inputs, which the next commit's
// plan compares with; a build without them is rebuilt on every commit.
func labelProblems(wf *ciscan.Workflow) []string {
	var problems []string
	for _, job := range buildJobs {
		problems = append(problems, jobLabelProblems(job, wf.Jobs[job].Steps)...)
	}

	return problems
}

// jobLabelProblems reports a job that pushes no image, or pushes one without
// the inputs label.
func jobLabelProblems(job string, steps []ciscan.Step) []string {
	var problems []string
	found := false
	for i := range steps {
		step := &steps[i]
		if !pushesImage(step) {
			continue
		}
		found = true
		labels, _ := step.StringWith("labels")
		if !hasLine(labels, inputsLabel) {
			problems = append(problems, fmt.Sprintf("%s job %s: step %q must label the image %s", ImagesWorkflow, job, step.Name, inputsLabel))
		}
	}
	if !found {
		problems = append(problems, fmt.Sprintf("%s job %s pushes no image with docker/build-push-action", ImagesWorkflow, job))
	}

	return problems
}

// pushesImage holds for a docker/build-push-action step that pushes.
func pushesImage(step *ciscan.Step) bool {
	if !strings.HasPrefix(step.Uses, "docker/build-push-action@") {
		return false
	}
	push, _ := step.BoolWith("push")

	return push
}

// inputsProblems reads every image's inputs from this checkout, as the
// select step will.
func inputsProblems(repoRoot string, rows [][]string) []string {
	ctx := context.Background()
	tree, err := ecrtag.GitRepo{Run: ecrtag.Run, Root: repoRoot}.Tree(ctx, "HEAD")
	if err != nil {
		return []string{fmt.Sprintf("read the files of HEAD: %v", err)}
	}
	in := ecrtag.Inputs{Tree: tree, Read: ecrtag.ReadFile(repoRoot), GoDeps: ecrtag.GoList(ecrtag.Run, repoRoot)}
	var problems []string
	for _, row := range rows {
		if _, err := in.Files(ctx, row[2]); err != nil {
			problems = append(problems, fmt.Sprintf("%s: the inputs of %s cannot be read, so it would be rebuilt on every commit: %v", ImagesWorkflow, row[1], err))
		}
	}

	return problems
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

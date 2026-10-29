package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

const (
	dispatchInput  = "${{ inputs.image_tag }}"
	metaImageTag   = "${{ needs.meta.outputs.image_tag }}"
	takesInput     = `IMAGE_TAG="${INPUT_IMAGE_TAG}"`
	writesImageTag = `-t "${repo}:${IMAGE_TAG}"`
)

// ecrtagTag is the -tag an ecrtag call checks.
var ecrtagTag = regexp.MustCompile(`cmd/ecrtag\s+published\b[^\n]*?-tag\s+(\S+)`)

// ECRDispatchTags reports a publish-docker-ecr.yml that could skip or miss the
// tag a run is asked to write: any trigger but a push to main and a dispatch
// (so no run writes a <version> tag), a dispatch's image_tag not becoming the
// run's tag, or create-manifest checking a tag other than the one it writes,
// which would let an already-published git-<sha> stop a new custom tag.
// See specs/ci/publish-ecr-images.feature.
func ECRDispatchTags(repoRoot string) ([]string, error) {
	triggers, branches, err := imagesTriggers(repoRoot)
	if err != nil {
		return nil, err
	}
	wf, err := ciscan.Load(repoRoot, ImagesWorkflow)
	if err != nil {
		return nil, err
	}
	var problems []string
	if !slices.Equal(triggers, []string{"push", "workflow_dispatch"}) || !slices.Equal(branches, []string{"main"}) {
		problems = append(problems, fmt.Sprintf("%s must run only on a push to main and on workflow_dispatch, found on: %v (push branches %v)", ImagesWorkflow, triggers, branches))
	}
	if !jobHasStep(wf.Jobs["meta"], dispatchTagStep) {
		problems = append(problems, fmt.Sprintf("%s job meta must set IMAGE_TAG from INPUT_IMAGE_TAG: %s", ImagesWorkflow, dispatchInput))
	}
	if !jobHasStep(wf.Jobs[manifestJob], checksWhatItWrites) {
		problems = append(problems, fmt.Sprintf("%s job %s must check with ecrtag only the tag it writes (-tag \"${IMAGE_TAG}\", IMAGE_TAG: %s) and write %s", ImagesWorkflow, manifestJob, metaImageTag, writesImageTag))
	}

	return problems, nil
}

func jobHasStep(j ciscan.Job, ok func(*ciscan.Step) bool) bool {
	for i := range j.Steps {
		if ok(&j.Steps[i]) {
			return true
		}
	}

	return false
}

func dispatchTagStep(step *ciscan.Step) bool {
	return step.Env["INPUT_IMAGE_TAG"] == dispatchInput && strings.Contains(step.Run, takesInput)
}

func checksWhatItWrites(step *ciscan.Step) bool {
	if step.Env["IMAGE_TAG"] != metaImageTag || !strings.Contains(step.Run, writesImageTag) {
		return false
	}
	run := strings.ReplaceAll(step.Run, "\\\n", " ")
	checked := ecrtagTag.FindAllStringSubmatch(run, -1)
	for _, m := range checked {
		if m[1] != `"${IMAGE_TAG}"` {
			return false
		}
	}

	return len(checked) > 0
}

// imagesTriggers is the sorted event names of the workflow's on: and the
// branches its push trigger lists.
func imagesTriggers(repoRoot string) ([]string, []string, error) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, ImagesWorkflow))
	if err != nil {
		return nil, nil, fmt.Errorf("read %s: %w", ImagesWorkflow, err)
	}
	var doc struct {
		On yaml.Node `yaml:"on"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, nil, fmt.Errorf("parse %s: %w", ImagesWorkflow, err)
	}
	if doc.On.Kind != yaml.MappingNode {
		return []string{doc.On.Value}, nil, nil
	}
	var events []string
	for i := 0; i+1 < len(doc.On.Content); i += 2 {
		events = append(events, doc.On.Content[i].Value)
	}
	slices.Sort(events)

	return events, pushBranches(valueOf(&doc.On, "push")), nil
}

// pushBranches is what push: lists. Anything but branches (tags, paths) is
// reported as a branch, so a tag push cannot pass as a push to main.
func pushBranches(node *yaml.Node) []string {
	var push map[string][]string
	if node == nil || node.Decode(&push) != nil {
		return nil
	}
	var branches []string
	for key, values := range push {
		if key != "branches" {
			values = []string{key}
		}
		branches = append(branches, values...)
	}

	return branches
}

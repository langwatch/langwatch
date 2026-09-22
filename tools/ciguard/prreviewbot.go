package ciguard

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// PRReviewBotWorkflow is the workflow this guard reads.
const PRReviewBotWorkflow = ".github/workflows/pr-review-bot.yml"

// prReviewBotGateClauses are the job-level `if:` clauses the review job
// depends on to stay off Dependabot PRs (separate secret store), fork PRs (no
// access to repo secrets), and drafts (not ready for review). Read as literal
// text rather than evaluated — like goversion.go reading a Go directive, this
// guard's job is to notice a clause disappearing, not to re-implement
// GitHub's expression language.
var prReviewBotGateClauses = map[string]string{
	"dependabot": "user.login != 'dependabot[bot]'",
	"fork":       "head.repo.full_name == github.repository",
	"draft":      "draft == false",
}

// prReviewBotTriggerTypes are the pull_request event types that (subject to
// the gate above) can run a review.
var prReviewBotTriggerTypes = []string{"opened", "synchronize", "reopened", "ready_for_review"}

// prReviewBotRequiredPermissions are the exact permissions the review job must grant:
// contents: write (for resolveReviewThread) and pull-requests: write (for posting reviews).
var prReviewBotRequiredPermissions = map[string]string{
	"contents":      "write",
	"pull-requests": "write",
}

// fullSHAPattern matches a full 40-character commit SHA, the only ref this
// workflow's pins are allowed to carry.
var fullSHAPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

// PRReviewBot reports every way the PR Review Bot workflow has drifted from
// the invariants specs/ci/pr-review-bot.feature describes: the three-clause
// skip gate, the trigger types that can run a review, single-review-in-flight
// concurrency, full-SHA pinning on every action it uses, and the required
// permissions block.
func PRReviewBot(repoRoot string) ([]string, error) {
	workflow, err := ciscan.Load(repoRoot, PRReviewBotWorkflow)
	if err != nil {
		return nil, err
	}

	var problems []string
	problems = append(problems, prReviewBotGates(workflow)...)
	problems = append(problems, prReviewBotTriggers(workflow)...)
	problems = append(problems, prReviewBotConcurrency(workflow)...)
	problems = append(problems, prReviewBotPermissions(workflow)...)
	problems = append(problems, prReviewBotPinning(workflow)...)

	return problems, nil
}

// prReviewBotReviewJob is the workflow's single job. The skip clauses live on
// its `if:`; a guard that joined every job's `if:` would keep passing after a
// clause drifted onto some unrelated job, so the check reads this job alone.
const prReviewBotReviewJob = "review"

// prReviewBotGates checks the three skip clauses are still present on the
// review job's `if:` condition, and reports when the job itself is gone.
func prReviewBotGates(workflow *ciscan.Workflow) []string {
	job, ok := workflow.Jobs[prReviewBotReviewJob]
	if !ok {
		return []string{fmt.Sprintf(
			"%s has no %q job to gate", PRReviewBotWorkflow, prReviewBotReviewJob)}
	}

	names := make([]string, 0, len(prReviewBotGateClauses))
	for name := range prReviewBotGateClauses {
		names = append(names, name)
	}
	sort.Strings(names)

	var problems []string
	for _, name := range names {
		clause := prReviewBotGateClauses[name]
		if !strings.Contains(job.If, clause) {
			problems = append(problems, fmt.Sprintf(
				"%s no longer gates on %q (%s check missing)", PRReviewBotWorkflow, clause, name))
		}
	}

	return problems
}

// prReviewBotTriggers checks the pull_request trigger fires on exactly the
// event types the review job's scenarios describe — no fewer (a dropped type
// silently stops reviewing that event) and no more (an added type runs
// against an event the gate above was never proven against).
func prReviewBotTriggers(workflow *ciscan.Workflow) []string {
	got := slices.Clone(workflow.On.PullRequest.Types)
	if len(got) == 0 {
		return []string{fmt.Sprintf("%s declares no pull_request `types:` list", PRReviewBotWorkflow)}
	}
	sort.Strings(got)

	want := slices.Clone(prReviewBotTriggerTypes)
	sort.Strings(want)

	if slices.Equal(got, want) {
		return nil
	}

	return []string{fmt.Sprintf(
		"%s pull_request types are %v, want %v",
		PRReviewBotWorkflow, workflow.On.PullRequest.Types, prReviewBotTriggerTypes)}
}

// prReviewBotConcurrency checks the workflow cancels a superseded run for the
// same PR rather than letting two reviews for the same PR race to completion.
func prReviewBotConcurrency(workflow *ciscan.Workflow) []string {
	var problems []string

	group := strings.TrimSpace(workflow.Concurrency.Group)
	switch {
	case group == "":
		problems = append(problems, fmt.Sprintf("%s declares no concurrency group", PRReviewBotWorkflow))
	case !strings.Contains(group, "github.event.pull_request.number"):
		problems = append(problems, fmt.Sprintf(
			"%s concurrency group %q does not key on the PR number", PRReviewBotWorkflow, group))
	}

	if !workflow.Concurrency.CancelsInProgress() {
		problems = append(problems, fmt.Sprintf("%s does not set cancel-in-progress: true", PRReviewBotWorkflow))
	}

	return problems
}

// prReviewBotPermissions checks the workflow's top-level permissions block
// grants exactly contents: write and pull-requests: write, with no extra
// permissions. contents: write is required for resolveReviewThread.
func prReviewBotPermissions(workflow *ciscan.Workflow) []string {
	if workflow.Permissions.Shorthand != "" {
		return []string{fmt.Sprintf(
			"%s permissions block uses shorthand %q, want an explicit contents/pull-requests mapping",
			PRReviewBotWorkflow, workflow.Permissions.Shorthand)}
	}

	perms := workflow.Permissions.Scopes
	if perms == nil {
		return []string{fmt.Sprintf("%s declares no top-level permissions block", PRReviewBotWorkflow)}
	}

	var problems []string

	// Check that required permissions exist with correct values
	for key, expectedValue := range prReviewBotRequiredPermissions {
		actualValue, exists := perms[key]
		if !exists {
			problems = append(problems, fmt.Sprintf(
				"%s permissions block missing %q (required for PR reviews)", PRReviewBotWorkflow, key))
		} else if actualValue != expectedValue {
			problems = append(problems, fmt.Sprintf(
				"%s permissions block grants %s: %q, want %q", PRReviewBotWorkflow, key, actualValue, expectedValue))
		}
	}

	// Check that no extra permissions are granted
	for key := range perms {
		if _, required := prReviewBotRequiredPermissions[key]; !required {
			problems = append(problems, fmt.Sprintf(
				"%s permissions block has extra key %q (only contents and pull-requests are needed)", PRReviewBotWorkflow, key))
		}
	}

	return problems
}

// prReviewBotPinning enforces the pinning invariant every `uses:` step in this
// workflow must meet: a full 40-character commit SHA, never a floating tag or
// branch, with a trailing comment recording what it means. Both the ref and
// its trailing comment come from ciscan's decoded step, so a quoted value or a
// `uses:` line inside a run: script cannot fool the check the way a raw text
// scan could.
func prReviewBotPinning(workflow *ciscan.Workflow) []string {
	steps := usesSteps(workflow)
	if len(steps) == 0 {
		return []string{fmt.Sprintf("%s has no `uses:` steps, so this guard is watching nothing", PRReviewBotWorkflow)}
	}

	var problems []string
	for _, step := range steps {
		if problem, bad := pinProblem(step); bad {
			problems = append(problems, problem)
		}
	}

	return problems
}

// usesSteps collects every step with a non-empty `uses:` value across the
// workflow's jobs, in sorted-job order so guard output is stable.
func usesSteps(workflow *ciscan.Workflow) []ciscan.Step {
	var steps []ciscan.Step
	for _, job := range workflow.JobNames() {
		for _, step := range workflow.Jobs[job].Steps {
			if step.Uses != "" {
				steps = append(steps, step)
			}
		}
	}

	return steps
}

// pinProblem reports the single pinning problem a `uses:` step has, if any: a
// ref that is not a full commit SHA, or a full-SHA pin with no version comment.
func pinProblem(step ciscan.Step) (problem string, bad bool) {
	use := step.Uses
	if strings.HasPrefix(use, "./") {
		// Local composite/reusable actions resolve from the checked-out repo,
		// not a registry ref, so there is nothing to pin.
		return "", false
	}

	action, ref, found := strings.Cut(use, "@")
	if !found || !fullSHAPattern.MatchString(ref) {
		return fmt.Sprintf(
			"%s pins %s to %q, which is not a full 40-character commit SHA", PRReviewBotWorkflow, action, ref), true
	}

	if step.UsesComment == "" {
		return fmt.Sprintf(
			"%s pins %s to a SHA with no version comment", PRReviewBotWorkflow, action), true
	}

	return "", false
}

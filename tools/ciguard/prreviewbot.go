package ciguard

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// PRReviewBotWorkflow is the workflow this guard reads: the review is a job of
// pr.yml so it can wait for ci-complete.
const PRReviewBotWorkflow = PRWorkflowFile

// prReviewBotGateClauses are the job-level `if:` clauses the review job
// depends on to stay off Dependabot PRs (separate secret store), fork PRs (no
// access to repo secrets), drafts (not ready for review), the merge queue (the
// bot reads github.event.pull_request) and a change CI did not pass. It also
// needs !cancelled(): a job's implicit success() checks every job upstream,
// transitively, so a call path-filtered away above ci-complete would skip the
// review even though ci-complete passed, and a skipped required check passes.
// Read as literal text rather than evaluated — like goversion.go reading a Go
// directive, this guard's job is to notice a clause disappearing, not to
// re-implement GitHub's expression language.
var prReviewBotGateClauses = map[string]string{
	"dependabot":   "user.login != 'dependabot[bot]'",
	"fork":         "head.repo.full_name == github.repository",
	"draft":        "draft == false",
	"pull request": "github.event_name == 'pull_request'",
	"ci-complete":  "needs.ci-complete.result == 'success'",
	"skipped call": "!cancelled()",
	// pr.yml may declare more pull_request types for the product checks (a
	// review per label or edit would burn tokens), so the job lists its own.
	"event type": prReviewBotEventTypeClause(),
}

// prReviewBotTriggerTypes are the pull_request event types that (subject to
// the gate above) can run a review.
var prReviewBotTriggerTypes = []string{"opened", "synchronize", "reopened", "ready_for_review"}

// prReviewBotEventTypeClause is the `if:` clause limiting the review job to
// prReviewBotTriggerTypes, as pr.yml spells it.
func prReviewBotEventTypeClause() string {
	return `contains(fromJSON('["` + strings.Join(prReviewBotTriggerTypes, `","`) + `"]'), github.event.action)`
}

// prReviewBotRequiredPermissions are the exact permissions the review job must grant:
// contents: write (for resolveReviewThread), pull-requests: write (for posting
// reviews) and checks: read (for listing the head commit's check runs while
// waiting for them).
var prReviewBotRequiredPermissions = map[string]string{
	"checks":        "read",
	"contents":      "write",
	"pull-requests": "write",
}

// fullSHAPattern matches a full 40-character commit SHA, the only ref this
// workflow's pins are allowed to carry.
var fullSHAPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

// PRReviewBot reports every way the PR Review Bot workflow has drifted from
// the invariants specs/ci/pr-review-bot.feature describes: the wait for
// ci-complete, the wait for every other check, the skip gate, the trigger
// types that can run a review, single-review-in-flight concurrency, full-SHA
// pinning on every action it uses, and the required permissions block.
func PRReviewBot(repoRoot string) ([]string, error) {
	workflow, err := ciscan.Load(repoRoot, PRReviewBotWorkflow)
	if err != nil {
		return nil, err
	}

	var problems []string
	problems = append(problems, prReviewBotNeeds(workflow)...)
	problems = append(problems, prReviewBotGates(workflow)...)
	problems = append(problems, prReviewBotWaitsForChecks(workflow)...)
	problems = append(problems, prReviewBotTriggers(workflow)...)
	problems = append(problems, prReviewBotConcurrency(workflow)...)
	problems = append(problems, prReviewBotPermissions(workflow)...)
	problems = append(problems, prReviewBotPinning(workflow)...)

	return problems, nil
}

// prReviewBotReviewJob is the job that reviews. The skip clauses live on
// its `if:`; a guard that joined every job's `if:` would keep passing after a
// clause drifted onto some unrelated job, so the check reads this job alone.
const prReviewBotReviewJob = "review"

// prReviewBotNeeds checks the review job waits for ci-complete. Without it the
// needs.ci-complete clause reads empty and every review is skipped, and a
// skipped job satisfies the required check, so nothing else would notice.
func prReviewBotNeeds(workflow *ciscan.Workflow) []string {
	job, ok := workflow.Jobs[prReviewBotReviewJob]
	if !ok || needsJob(job.Needs, "ci-complete") { // prReviewBotGates reports a missing job
		return nil
	}

	return []string{fmt.Sprintf("%s review job does not have needs: ci-complete", PRReviewBotWorkflow)}
}

// prReviewBotGates checks the skip clauses are still present on the
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

// prReviewBotWaitCommand is what the review job's wait step runs: it blocks
// until every other check run on the head commit finished and exits non-zero
// (failing the job) when one failed or the wait timed out. Its behaviour is
// tested in tools/waitforchecks; this guard only notices it going missing.
const prReviewBotWaitCommand = "go run ./cmd/waitforchecks"

// prReviewBotBotAction is the action that spends the tokens.
const prReviewBotBotAction = "langwatch/langwatch-pr-review-bot@"

// prReviewBotWaitsForChecks checks the review job still waits for the checks of
// the separate workflows (ci-complete covers only pr.yml's own calls) before
// the bot step. A failed wait fails the job, so the bot never runs after it. Like
// the gate clauses, it reads literal text: a wait that vanished, or moved after
// the bot, would let the review start on a PR whose other checks are still
// running or red, and nothing else would notice.
func prReviewBotWaitsForChecks(workflow *ciscan.Workflow) []string {
	job, ok := workflow.Jobs[prReviewBotReviewJob]
	if !ok { // prReviewBotGates reports a missing job
		return nil
	}

	waits := slices.IndexFunc(job.Steps, func(step ciscan.Step) bool {
		return strings.Contains(step.Run, prReviewBotWaitCommand)
	})
	if waits < 0 {
		return []string{fmt.Sprintf(
			"%s review job has no step running %q to wait for the other checks", PRReviewBotWorkflow, prReviewBotWaitCommand)}
	}

	bot := slices.IndexFunc(job.Steps, func(step ciscan.Step) bool {
		return strings.HasPrefix(step.Uses, prReviewBotBotAction)
	})
	if bot >= 0 && bot < waits {
		return []string{fmt.Sprintf(
			"%s review job runs the bot before the wait for the other checks", PRReviewBotWorkflow)}
	}

	return nil
}

// prReviewBotTriggers checks the pull_request trigger still fires on every
// event type the review job's scenarios describe (a dropped type silently
// stops reviewing that event). Extra types are allowed: pr.yml is shared with
// the product checks, which may need more.
func prReviewBotTriggers(workflow *ciscan.Workflow) []string {
	got := workflow.On.PullRequest.Types
	if len(got) == 0 {
		return []string{fmt.Sprintf("%s declares no pull_request `types:` list", PRReviewBotWorkflow)}
	}

	var missing []string
	for _, want := range prReviewBotTriggerTypes {
		if !slices.Contains(got, want) {
			missing = append(missing, want)
		}
	}
	if len(missing) == 0 {
		return nil
	}

	return []string{fmt.Sprintf(
		"%s pull_request types %v lack %v (the review needs all of %v)",
		PRReviewBotWorkflow, got, missing, prReviewBotTriggerTypes)}
}

// prReviewBotConcurrency checks only what the review depends on: a group keyed
// on the PR number with cancel-in-progress, so a superseded run (and its wait)
// is cancelled rather than two reviews for the same PR racing. It does not pin
// the rest of the shared workflow's concurrency block.
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

// prReviewBotPermissions checks the review job's effective permissions block
// grants exactly checks: read, contents: write and pull-requests: write, with
// no extra permissions. contents: write is required for resolveReviewThread
// and checks: read for listing the head commit's check runs. GitHub
// permissions blocks do not merge: a job-level `permissions:` completely
// replaces the workflow-level one when present, so the effective set is the
// job's block if it declares one, else the workflow's.
func prReviewBotPermissions(workflow *ciscan.Workflow) []string {
	perms := workflow.EffectivePermissions(prReviewBotReviewJob)

	if perms.Shorthand != "" {
		return []string{fmt.Sprintf(
			"%s permissions block uses shorthand %q, want an explicit checks/contents/pull-requests mapping",
			PRReviewBotWorkflow, perms.Shorthand)}
	}

	scopes := perms.Scopes
	if scopes == nil {
		return []string{fmt.Sprintf("%s declares no permissions block for the review job", PRReviewBotWorkflow)}
	}

	return comparePRReviewBotPermissionScopes(scopes)
}

// comparePRReviewBotPermissionScopes diffs a workflow's effective permission
// scopes against prReviewBotRequiredPermissions in both directions: keys the
// review job needs but doesn't have (missing or wrong value), and keys it
// has but doesn't need (broader than the invariant allows).
func comparePRReviewBotPermissionScopes(scopes map[string]string) []string {
	requiredKeys := make([]string, 0, len(prReviewBotRequiredPermissions))
	for key := range prReviewBotRequiredPermissions {
		requiredKeys = append(requiredKeys, key)
	}
	sort.Strings(requiredKeys)

	var problems []string
	for _, key := range requiredKeys {
		expectedValue := prReviewBotRequiredPermissions[key]
		actualValue, exists := scopes[key]
		if !exists {
			problems = append(problems, fmt.Sprintf(
				"%s permissions block missing %q (required for PR reviews)", PRReviewBotWorkflow, key))
		} else if actualValue != expectedValue {
			problems = append(problems, fmt.Sprintf(
				"%s permissions block grants %s: %q, want %q", PRReviewBotWorkflow, key, actualValue, expectedValue))
		}
	}

	grantedKeys := make([]string, 0, len(scopes))
	for key := range scopes {
		grantedKeys = append(grantedKeys, key)
	}
	sort.Strings(grantedKeys)

	for _, key := range grantedKeys {
		if _, required := prReviewBotRequiredPermissions[key]; !required {
			problems = append(problems, fmt.Sprintf(
				"%s permissions block has extra key %q (only checks, contents and pull-requests are needed)", PRReviewBotWorkflow, key))
		}
	}

	return problems
}

// prReviewBotPinning enforces the pinning invariant every `uses:` step of the
// review job must meet: a full 40-character commit SHA, never a floating tag or
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
	for i := range steps {
		if problem, bad := pinProblem(steps[i]); bad {
			problems = append(problems, problem)
		}
	}

	return problems
}

// usesSteps collects every step of the review job with a non-empty `uses:`
// value. The other jobs of pr.yml are not this guard's to police.
func usesSteps(workflow *ciscan.Workflow) []ciscan.Step {
	var steps []ciscan.Step
	jobSteps := workflow.Jobs[prReviewBotReviewJob].Steps
	for i := range jobSteps {
		if jobSteps[i].Uses != "" {
			steps = append(steps, jobSteps[i])
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

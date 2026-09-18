package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
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

var (
	// usesCommentPattern recovers the trailing `# <version>` comment on a
	// `uses:` line. The workflow is read structurally through ciscan; this raw
	// scan exists only for the comment, which yaml drops. `[ \t]*` — not
	// `\s*` — so the comment must sit on the same line as the pin it
	// documents, never on a following line.
	usesCommentPattern = regexp.MustCompile(`(?m)^[ \t]*-?[ \t]*uses:[ \t]*(\S+)[ \t]*(#.*)?$`)
	fullSHAPattern     = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

// PRReviewBot reports every way the PR Review Bot workflow has drifted from
// the invariants specs/ci/pr-review-bot.feature describes: the three-clause
// skip gate, the trigger types that can run a review, single-review-in-flight
// concurrency, and full-SHA pinning on every action it uses.
func PRReviewBot(repoRoot string) ([]string, error) {
	workflow, err := ciscan.Load(repoRoot, PRReviewBotWorkflow)
	if err != nil {
		return nil, err
	}

	raw, err := os.ReadFile(filepath.Join(repoRoot, PRReviewBotWorkflow))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", PRReviewBotWorkflow, err)
	}

	var problems []string
	problems = append(problems, prReviewBotGates(workflow)...)
	problems = append(problems, prReviewBotTriggers(workflow)...)
	problems = append(problems, prReviewBotConcurrency(workflow)...)
	problems = append(problems, prReviewBotPinning(workflow, string(raw))...)

	return problems, nil
}

// prReviewBotGates checks the three skip clauses are still present in some
// job's `if:` condition.
func prReviewBotGates(workflow *ciscan.Workflow) []string {
	conditions := make([]string, 0, len(workflow.Jobs))
	for _, job := range workflow.JobNames() {
		conditions = append(conditions, workflow.Jobs[job].If)
	}
	joined := strings.Join(conditions, "\n")

	names := make([]string, 0, len(prReviewBotGateClauses))
	for name := range prReviewBotGateClauses {
		names = append(names, name)
	}
	sort.Strings(names)

	var problems []string
	for _, name := range names {
		clause := prReviewBotGateClauses[name]
		if !strings.Contains(joined, clause) {
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

	if cancels, isValid := workflow.Concurrency.CancelsInProgress(); !isValid || !cancels {
		problems = append(problems, fmt.Sprintf("%s does not set cancel-in-progress: true", PRReviewBotWorkflow))
	}

	return problems
}

// prReviewBotPinning enforces the pinning invariant every `uses:` step in this
// workflow must meet: a full 40-character commit SHA, never a floating tag or
// branch, with a trailing comment recording what it means. The action and ref
// come from ciscan; the comment comes from the raw scan, since yaml drops it.
func prReviewBotPinning(workflow *ciscan.Workflow, raw string) []string {
	commented := commentedUses(raw)

	var uses []string
	for _, job := range workflow.JobNames() {
		for _, step := range workflow.Jobs[job].Steps {
			if step.Uses != "" {
				uses = append(uses, step.Uses)
			}
		}
	}

	if len(uses) == 0 {
		return []string{fmt.Sprintf("%s has no `uses:` steps, so this guard is watching nothing", PRReviewBotWorkflow)}
	}

	var problems []string
	for _, use := range uses {
		action, ref, found := strings.Cut(use, "@")
		if !found || !fullSHAPattern.MatchString(ref) {
			problems = append(problems, fmt.Sprintf(
				"%s pins %s to %q, which is not a full 40-character commit SHA", PRReviewBotWorkflow, action, ref))

			continue
		}

		if !commented[use] {
			problems = append(problems, fmt.Sprintf(
				"%s pins %s to a SHA with no version comment", PRReviewBotWorkflow, action))
		}
	}

	return problems
}

// commentedUses maps each `uses:` value to whether its line carries a trailing
// `#` comment. A value can appear on more than one step; a single documented
// occurrence is enough to treat that pin as commented.
func commentedUses(raw string) map[string]bool {
	commented := make(map[string]bool)
	for _, match := range usesCommentPattern.FindAllStringSubmatch(raw, -1) {
		use := match[1]
		commented[use] = commented[use] || strings.TrimSpace(match[2]) != ""
	}

	return commented
}

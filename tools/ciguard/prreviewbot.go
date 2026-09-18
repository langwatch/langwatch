package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
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
	triggerTypesPattern     = regexp.MustCompile(`(?m)^\s*types:\s*\[([^\]]*)\]`)
	concurrencyGroupPattern = regexp.MustCompile(`(?m)^\s*group:\s*(.+?)\s*$`)
	cancelInProgressPattern = regexp.MustCompile(`(?m)^\s*cancel-in-progress:\s*(\S+)\s*$`)
	usesPattern             = regexp.MustCompile(`(?m)^\s*-?\s*uses:\s*([^@\s]+)@(\S+)\s*(#.*)?$`)
	fullSHAPattern          = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

// PRReviewBot reports every way the PR Review Bot workflow has drifted from
// the invariants specs/ci/pr-review-bot.feature describes: the three-clause
// skip gate, the trigger types that can run a review, single-review-in-flight
// concurrency, and full-SHA pinning on every action it uses.
func PRReviewBot(repoRoot string) ([]string, error) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, PRReviewBotWorkflow))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", PRReviewBotWorkflow, err)
	}
	content := string(raw)

	var problems []string
	problems = append(problems, prReviewBotGates(content)...)
	problems = append(problems, prReviewBotTriggers(content)...)
	problems = append(problems, prReviewBotConcurrency(content)...)
	problems = append(problems, prReviewBotPinning(content)...)

	return problems, nil
}

// prReviewBotGates checks the three skip clauses are still present in the
// job's `if:` condition.
func prReviewBotGates(content string) []string {
	var problems []string

	names := make([]string, 0, len(prReviewBotGateClauses))
	for name := range prReviewBotGateClauses {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		clause := prReviewBotGateClauses[name]
		if !strings.Contains(content, clause) {
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
func prReviewBotTriggers(content string) []string {
	match := triggerTypesPattern.FindStringSubmatch(content)
	if match == nil {
		return []string{fmt.Sprintf("%s declares no pull_request `types:` list", PRReviewBotWorkflow)}
	}

	var got []string
	for _, raw := range strings.Split(match[1], ",") {
		if trimmed := strings.TrimSpace(raw); trimmed != "" {
			got = append(got, trimmed)
		}
	}
	sort.Strings(got)

	want := slices.Clone(prReviewBotTriggerTypes)
	sort.Strings(want)

	if slices.Equal(got, want) {
		return nil
	}

	return []string{fmt.Sprintf(
		"%s pull_request types are %v, want %v", PRReviewBotWorkflow, got, prReviewBotTriggerTypes)}
}

// prReviewBotConcurrency checks the workflow cancels a superseded run for the
// same PR rather than letting two reviews for the same PR race to
// completion.
func prReviewBotConcurrency(content string) []string {
	var problems []string

	group := concurrencyGroupPattern.FindStringSubmatch(content)
	switch {
	case group == nil:
		problems = append(problems, fmt.Sprintf("%s declares no concurrency group", PRReviewBotWorkflow))
	case !strings.Contains(group[1], "github.event.pull_request.number"):
		problems = append(problems, fmt.Sprintf(
			"%s concurrency group %q does not key on the PR number", PRReviewBotWorkflow, group[1]))
	}

	cancel := cancelInProgressPattern.FindStringSubmatch(content)
	if cancel == nil || !strings.EqualFold(cancel[1], "true") {
		problems = append(problems, fmt.Sprintf("%s does not set cancel-in-progress: true", PRReviewBotWorkflow))
	}

	return problems
}

// prReviewBotPinning enforces the pinning invariant every `uses:` step in
// this workflow must meet: a full 40-character commit SHA, never a floating
// tag or branch, with a trailing comment recording what it means.
func prReviewBotPinning(content string) []string {
	matches := usesPattern.FindAllStringSubmatch(content, -1)
	if matches == nil {
		return []string{fmt.Sprintf("%s has no `uses:` steps, so this guard is watching nothing", PRReviewBotWorkflow)}
	}

	var problems []string
	for _, match := range matches {
		action, ref, comment := match[1], match[2], strings.TrimSpace(match[3])

		if !fullSHAPattern.MatchString(ref) {
			problems = append(problems, fmt.Sprintf(
				"%s pins %s to %q, which is not a full 40-character commit SHA", PRReviewBotWorkflow, action, ref))
			continue
		}

		if comment == "" {
			problems = append(problems, fmt.Sprintf(
				"%s pins %s to a SHA with no version comment", PRReviewBotWorkflow, action))
		}
	}

	return problems
}

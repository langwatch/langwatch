package ciguard_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/ciguard"
)

// prReviewBotPermissionsBlock is the review job's `permissions:` block, kept as its own constant so it stays in sync with the tests that strip or replace it.
const prReviewBotPermissionsBlock = `    permissions:
      checks: read
      contents: write # so the default token can call resolveReviewThread; read would only lose thread auto-resolution
      pull-requests: write
`

// prWorkflowPermissionsBlock is pr.yml's own block, which the review job's replaces.
const prWorkflowPermissionsBlock = `permissions:
  contents: read
`

// prReviewBotWaitStep is the review job's wait step with its failure branch.
const prReviewBotWaitStep = `      - id: wait-for-checks
        run: |
          gh api "repos/$GITHUB_REPOSITORY/commits/$SHA/check-runs"
          if grep -qx failed <<<"$states"; then
            echo "::error::another check failed; fix it and push"
            exit 1
          fi
`

// goodPRReviewBotWorkflow mirrors the review job of .github/workflows/pr.yml as
// it stands when every invariant holds. Individual tests mutate one clause of
// it at a time so each failure mode is isolated.
const goodPRReviewBotWorkflow = `name: pr

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  merge_group:

` + prWorkflowPermissionsBlock + `
concurrency:
  group: pr-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  review:
    needs: ci-complete
    if: |
      needs.ci-complete.result == 'success' &&
      github.event_name == 'pull_request' &&
      github.event.pull_request.user.login != 'dependabot[bot]' &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      github.event.pull_request.draft == false
    runs-on: ubuntu-latest
` + prReviewBotPermissionsBlock + `    steps:
` + prReviewBotWaitStep + `      - if: steps.wait-for-checks.outputs.proceed == 'true'
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      - if: steps.wait-for-checks.outputs.proceed == 'true'
        uses: langwatch/langwatch-pr-review-bot@7ff0638fa8cb21fb3f94f8a12b893c6d5446e521 # main 2026-09-22
        with:
          slack_notify: "false"
          claude_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          langwatch_ingest_key: ${{ secrets.LANGWATCH_INGEST_KEY }}
`

// writePRReviewBotWorkflow lays out a throwaway repo containing only the
// workflow the PR Review Bot guard reads.
func writePRReviewBotWorkflow(t *testing.T, content string) string {
	t.Helper()

	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, ciscan.WorkflowDir), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(root, ciguard.PRReviewBotWorkflow), []byte(content), 0o600))

	return root
}

func TestPRReviewBotAcceptsTheGoodWorkflow(t *testing.T) {
	problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, goodPRReviewBotWorkflow))

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "Dependabot PRs are skipped"
func TestPRReviewBotGatesOnDependabot(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "user.login != 'dependabot[bot]' &&\n      ", "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "dependabot")
}

// @scenario "Pull requests from forks are skipped"
func TestPRReviewBotGatesOnFork(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		"github.event.pull_request.head.repo.full_name == github.repository &&\n      ", "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "fork")
}

// @scenario "Draft pull requests are skipped"
func TestPRReviewBotGatesOnDraft(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		" &&\n      github.event.pull_request.draft == false", "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "draft")
}

// @scenario "The review starts only after CI passed"
func TestPRReviewBotGatesOnCIComplete(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "      needs.ci-complete.result == 'success' &&\n", "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "ci-complete")
}

// @scenario "The review starts only after CI passed"
func TestPRReviewBotWaitsForCIComplete(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "    needs: ci-complete\n", "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "needs: ci-complete")
}

func TestPRReviewBotAcceptsCICompleteInANeedsList(t *testing.T) {
	listed := strings.Replace(goodPRReviewBotWorkflow, "    needs: ci-complete\n", "    needs: [changes, ci-complete]\n", 1)

	problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, listed))

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "The merge queue gets no review"
func TestPRReviewBotStaysOutOfTheMergeQueue(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "      github.event_name == 'pull_request' &&\n", "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "pull request")
}

func TestPRReviewBotReportsAMissingReviewJob(t *testing.T) {
	renamed := strings.Replace(goodPRReviewBotWorkflow, "  review:", "  reviewer:", 1)
	root := writePRReviewBotWorkflow(t, renamed)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), `has no "review" job to gate`)
}

// @scenario "Review runs on pull request opened"
func TestPRReviewBotTriggersOnOpened(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		"types: [opened, synchronize, reopened, ready_for_review]",
		"types: [synchronize, reopened, ready_for_review]", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "pull_request types")
}

// @scenario "Review runs on pull request synchronize"
func TestPRReviewBotTriggersOnSynchronize(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		"types: [opened, synchronize, reopened, ready_for_review]",
		"types: [opened, reopened, ready_for_review]", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "pull_request types")
}

// @scenario "Review runs on pull request reopened"
func TestPRReviewBotTriggersOnReopened(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		"types: [opened, synchronize, reopened, ready_for_review]",
		"types: [opened, synchronize, ready_for_review]", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "pull_request types")
}

// @scenario "Review runs on ready for review"
func TestPRReviewBotTriggersOnReadyForReview(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		"types: [opened, synchronize, reopened, ready_for_review]",
		"types: [opened, synchronize, reopened]", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "pull_request types")
}

// @scenario "The review waits for every other check on the head commit"
func TestPRReviewBotWaitsForTheOtherChecks(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, prReviewBotWaitStep, "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), `no step with id "wait-for-checks"`)
}

func TestPRReviewBotWaitReadsTheCheckRuns(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "commits/$SHA/check-runs", "commits/$SHA", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "does not read the head commit's check-runs")
}

// @scenario "a failed check fails the review job"
func TestPRReviewBotWaitFailsTheJobWhenACheckFailed(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "            exit 1\n", "            exit 0\n", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "can end green when another check failed")
}

// @scenario "a failed check fails the review job"
func TestPRReviewBotWaitPrintsTheFailureMessage(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "another check failed; fix it and push", "failed", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "does not print")
}

// @scenario "The review does not start when another check failed"
func TestPRReviewBotGatesEveryActionOnTheWait(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		"      - if: steps.wait-for-checks.outputs.proceed == 'true'\n        uses: langwatch", "      - uses: langwatch", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "langwatch/langwatch-pr-review-bot")
	assert.Contains(t, strings.Join(problems, "\n"), "is not gated")
}

// @scenario "In-progress review is canceled for the same PR"
func TestPRReviewBotCancelsInProgressRunsForTheSamePR(t *testing.T) {
	noCancel := strings.Replace(goodPRReviewBotWorkflow, "cancel-in-progress: true", "cancel-in-progress: false", 1)
	root := writePRReviewBotWorkflow(t, noCancel)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "cancel-in-progress: true")
}

func TestPRReviewBotRequiresTheGroupToKeyOnThePR(t *testing.T) {
	ungrouped := strings.Replace(goodPRReviewBotWorkflow,
		"group: pr-${{ github.event.pull_request.number || github.ref }}", "group: pr", 1)
	root := writePRReviewBotWorkflow(t, ungrouped)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "does not key on the PR number")
}

// @scenario "The review workflow grants exactly checks read, contents write and pull-requests write"
func TestPRReviewBotRequiresContentsWrite(t *testing.T) {
	withRead := strings.Replace(goodPRReviewBotWorkflow,
		"  contents: write",
		"  contents: read", 1)
	root := writePRReviewBotWorkflow(t, withRead)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), `permissions block grants contents: "read", want "write"`)
}

func TestPRReviewBotReportsAMissingPermissionsBlock(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, prReviewBotPermissionsBlock, "", 1)
	broken = strings.Replace(broken, prWorkflowPermissionsBlock, "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "declares no permissions block")
}

func TestPRReviewBotRequiresChecksRead(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "      checks: read\n", "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), `missing "checks"`)
}

func TestPRReviewBotReportsAMissingRequiredPermissionKey(t *testing.T) {
	withoutPullRequests := strings.Replace(goodPRReviewBotWorkflow,
		"      pull-requests: write\n", "", 1)
	root := writePRReviewBotWorkflow(t, withoutPullRequests)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), `missing "pull-requests"`)
}

func TestPRReviewBotRejectsShorthandPermissions(t *testing.T) {
	shorthand := strings.Replace(goodPRReviewBotWorkflow, prReviewBotPermissionsBlock, "    permissions: write-all\n", 1)
	root := writePRReviewBotWorkflow(t, shorthand)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), `shorthand "write-all"`)
}

func TestPRReviewBotRejectsExtraPermissions(t *testing.T) {
	withExtra := strings.Replace(goodPRReviewBotWorkflow,
		"      pull-requests: write",
		"      pull-requests: write\n      issues: write", 1)
	root := writePRReviewBotWorkflow(t, withExtra)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "issues")
	assert.Contains(t, strings.Join(problems, "\n"), "extra")
}

// @scenario "The review workflow grants exactly checks read, contents write and pull-requests write"
func TestPRReviewBotUsesJobLevelPermissionsWhenPresent(t *testing.T) {
	overridden := strings.Replace(goodPRReviewBotWorkflow, prWorkflowPermissionsBlock,
		"permissions:\n  contents: write\n  pull-requests: write\n", 1)
	overridden = strings.Replace(overridden, "      contents: write", "      contents: read", 1)
	root := writePRReviewBotWorkflow(t, overridden)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), `permissions block grants contents: "read", want "write"`)
}

// @scenario "Every action the workflow uses is pinned to a full commit SHA"
func TestPRReviewBotRejectsAFloatingTag(t *testing.T) {
	floating := strings.Replace(goodPRReviewBotWorkflow,
		"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
		"actions/checkout@v7", 1)
	root := writePRReviewBotWorkflow(t, floating)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "not a full 40-character commit SHA")
}

func TestPRReviewBotRejectsAFloatingBranchRef(t *testing.T) {
	floating := strings.Replace(goodPRReviewBotWorkflow,
		"langwatch/langwatch-pr-review-bot@7ff0638fa8cb21fb3f94f8a12b893c6d5446e521",
		"langwatch/langwatch-pr-review-bot@main", 1)
	root := writePRReviewBotWorkflow(t, floating)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "not a full 40-character commit SHA")
}

func TestPRReviewBotRejectsAPinWithNoVersionComment(t *testing.T) {
	uncommented := strings.Replace(goodPRReviewBotWorkflow,
		"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
		"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", 1)
	root := writePRReviewBotWorkflow(t, uncommented)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "no version comment")
}

// @scenario "Local composite actions are left out of the pin check"
func TestPRReviewBotAcceptsALocalCompositeAction(t *testing.T) {
	withLocalAction := strings.Replace(goodPRReviewBotWorkflow,
		"        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n",
		"        uses: ./.github/actions/go-build-cache\n"+
			"      - if: steps.wait-for-checks.outputs.proceed == 'true'\n"+
			"        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n", 1)
	root := writePRReviewBotWorkflow(t, withLocalAction)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}

func TestPRReviewBotReportsMissingTriggerTypes(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		"\n    types: [opened, synchronize, reopened, ready_for_review]", "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "declares no pull_request")
}

// pr.yml is shared with the product checks, so an extra type is not the review
// guard's to forbid.
func TestPRReviewBotAcceptsAnExtraTriggerType(t *testing.T) {
	extra := strings.Replace(goodPRReviewBotWorkflow,
		"types: [opened, synchronize, reopened, ready_for_review]",
		"types: [opened, synchronize, reopened, ready_for_review, edited]", 1)

	problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, extra))

	require.NoError(t, err)
	assert.Empty(t, problems)
}

func TestPRReviewBotReportsAMissingConcurrencyGroup(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		"\n  group: pr-${{ github.event.pull_request.number || github.ref }}", "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "declares no concurrency group")
}

func TestPRReviewBotReportsAWorkflowWithNoUsesSteps(t *testing.T) {
	_, stepsBlock, found := strings.Cut(goodPRReviewBotWorkflow, "    steps:")
	require.True(t, found)
	noUses := strings.Replace(goodPRReviewBotWorkflow, "    steps:"+stepsBlock,
		"    steps:\n      - run: echo no actions here\n", 1)
	root := writePRReviewBotWorkflow(t, noUses)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "has no `uses:` steps")
}

// A quoted `uses:` value carries its version comment just as an unquoted one
// does. A raw text scan keyed the comment by the quoted string while ciscan
// decoded the unquoted value, so the two never matched and the pin read as
// undocumented; reading the comment from the decoded node fixes that.
func TestPRReviewBotAcceptsAQuotedUsesValue(t *testing.T) {
	quoted := strings.Replace(goodPRReviewBotWorkflow,
		"- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
		`- uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1" # v7.0.1`, 1)
	root := writePRReviewBotWorkflow(t, quoted)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// The same action pinned twice, each occurrence documented, is fine. Each step
// is judged on its own decoded comment rather than on a text key shared across
// occurrences.
func TestPRReviewBotAcceptsARepeatedIdenticalStep(t *testing.T) {
	repeated := strings.Replace(goodPRReviewBotWorkflow,
		"      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n",
		"      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n"+
			"      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n", 1)
	root := writePRReviewBotWorkflow(t, repeated)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// A `uses:` line inside a run: script is script text, not a step, and must not
// document a real pin. Here the real checkout pin has its comment stripped and
// a run: script mentions the same action WITH a comment; a raw text scan let
// the script line mask the undocumented real pin, so the guard must still
// report the missing version comment.
func TestPRReviewBotIgnoresAUsesLineInsideARunScript(t *testing.T) {
	uncommented := strings.Replace(goodPRReviewBotWorkflow,
		"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
		"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", 1)
	withScript := strings.Replace(uncommented, "    steps:\n",
		"    steps:\n"+
			"      - run: |\n"+
			"          echo documenting the pin\n"+
			"          uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n", 1)
	root := writePRReviewBotWorkflow(t, withScript)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "no version comment")
}

func TestPRReviewBotHoldsInTheLiveRepo(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}

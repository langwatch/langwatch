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

// goodPRReviewBotWorkflow mirrors .github/workflows/pr-review-bot.yml as it
// stands when every invariant holds. Individual tests mutate one clause of
// it at a time so each failure mode is isolated.
const goodPRReviewBotWorkflow = `name: PR Review Bot

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: pr-review-bot-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    if: |
      github.event.pull_request.user.login != 'dependabot[bot]' &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      - uses: langwatch/langwatch-pr-review-bot@3b0a47e67927b9666da148f44f892de63d2feba7 # main 2026-09-18
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
		"group: pr-review-bot-${{ github.event.pull_request.number }}", "group: pr-review-bot", 1)
	root := writePRReviewBotWorkflow(t, ungrouped)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "does not key on the PR number")
}

// @scenario "Every action the workflow uses is pinned to a full commit SHA"
func TestPRReviewBotRejectsAFloatingTag(t *testing.T) {
	floating := strings.Replace(goodPRReviewBotWorkflow,
		"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
		"actions/checkout@v7 # v7", 1)
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

func TestPRReviewBotReportsMissingTriggerTypes(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		"\n    types: [opened, synchronize, reopened, ready_for_review]", "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "declares no pull_request")
}

func TestPRReviewBotReportsAnExtraTriggerType(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		"types: [opened, synchronize, reopened, ready_for_review]",
		"types: [opened, synchronize, reopened, ready_for_review, edited]", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "pull_request types")
}

func TestPRReviewBotReportsAMissingConcurrencyGroup(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		"\n  group: pr-review-bot-${{ github.event.pull_request.number }}", "", 1)
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

func TestPRReviewBotHoldsInTheLiveRepo(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}

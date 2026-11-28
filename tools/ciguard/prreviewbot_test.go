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

// prReviewBotPermissionsBlock is the review job's `permissions:` block, kept as its own
// constant so it stays in sync with the tests that strip or replace it.
const prReviewBotPermissionsBlock = `    permissions:
      actions: read
      checks: read
      contents: write # so the default token can call resolveReviewThread; read would only lose thread auto-resolution
      pull-requests: write
`

// prWorkflowPermissionsBlock is pr.yml's own block, which the review job's replaces.
const prWorkflowPermissionsBlock = `permissions:
  contents: read
`

// prReviewBotWaitStep is the review job's wait step.
const prReviewBotWaitStep = `      - run: go run ./cmd/waitforchecks
        env:
          REQUIRED_FROM_BRANCH: ${{ github.base_ref }}
        timeout-minutes: 50
`

// prReviewBotWakeStep is the review job's Laze wake step, between the wait and the bot.
const prReviewBotWakeStep = `      - name: Wake the Laze review bot
        continue-on-error: true
        timeout-minutes: 2
        env:
          LAZE_WAKE_KEY: ${{ secrets.LAZE_WAKE_KEY }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
        run: |
          [ -n "$LAZE_WAKE_KEY" ] || { echo "LAZE_WAKE_KEY not set; skipping wake"; exit 0; }
          jq -n --arg c "channel_000000DS08HpOve0vz6RzGSu0ZAC8" \
            --arg t "@LangWatch PR Review Bot review langwatch/langwatch#${PR_NUMBER} at ${HEAD_SHA:0:7}" \
            '{channel: $c, body: $t}' |
            curl -fsS -X POST https://laze.so/api/agents/me/messages \
              -H "Authorization: Bearer ${LAZE_WAKE_KEY}" \
              -H "Content-Type: application/json" --data-binary @-
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
      !cancelled() &&
      needs.ci-complete.result == 'success' &&
      github.event_name == 'pull_request' &&
      contains(fromJSON('["opened","synchronize","reopened","ready_for_review"]'), github.event.action) &&
      github.event.pull_request.user.login != 'dependabot[bot]' &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    timeout-minutes: 100
` + prReviewBotPermissionsBlock + `    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7.0.0
        with:
          go-version-file: go.work
` + prReviewBotWaitStep + prReviewBotWakeStep + `      - uses: langwatch/langwatch-pr-review-bot@7ff0638fa8cb21fb3f94f8a12b893c6d5446e521 # main 2026-09-22
        with:
          slack_notify: "false"
          review_timeout_minutes: 20
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

// @scenario "The review still starts when CI skipped checks the change does not reach"
func TestPRReviewBotStartsWhenCISkippedACall(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "      !cancelled() &&\n", "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "skipped call")
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

// @scenario "The review waits for every required check on the head commit"
func TestPRReviewBotWaitsForTheOtherChecks(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, prReviewBotWaitStep, "", 1)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), `no step running "go run ./cmd/waitforchecks"`)
}

// Without the base branch the wait reads every check, so an optional workflow
// holds the review's runner again.
// @scenario "A check the branch does not require never holds the review"
func TestPRReviewBotWaitsOnlyForTheRequiredChecks(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "          REQUIRED_FROM_BRANCH: ${{ github.base_ref }}\n", "", 1)
	require.NotEqual(t, goodPRReviewBotWorkflow, broken)

	problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, broken))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "REQUIRED_FROM_BRANCH")
}

// A failed wait fails the job, so the only way the bot runs on a red change is
// to run before the wait.
// @scenario "The review does not start when a required check failed"
func TestPRReviewBotRunsTheWaitBeforeTheBot(t *testing.T) {
	botAt := strings.Index(goodPRReviewBotWorkflow, "      - uses: langwatch")
	require.GreaterOrEqual(t, botAt, 0)
	bot := goodPRReviewBotWorkflow[botAt:]
	moved := strings.Replace(goodPRReviewBotWorkflow, bot, "", 1)
	moved = strings.Replace(moved, prReviewBotWaitStep, bot+prReviewBotWaitStep, 1)
	require.NotEqual(t, goodPRReviewBotWorkflow, moved)
	root := writePRReviewBotWorkflow(t, moved)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "runs the bot before the wait")
}

// A wait that cannot fail, or can be skipped, lets the bot run on a red change.
// @scenario "The review does not start when a required check failed"
func TestPRReviewBotRejectsAWaitThatCannotFailTheJob(t *testing.T) {
	const wait = "go run ./cmd/waitforchecks"
	cases := map[string]struct{ step, want string }{
		"continue-on-error": {
			step: "      - continue-on-error: true\n        run: " + wait + "\n",
			want: "continue-on-error",
		},
		"continue-on-error expression": {
			step: "      - continue-on-error: ${{ always() }}\n        run: " + wait + "\n",
			want: "continue-on-error",
		},
		"own if": {
			step: "      - if: always()\n        run: " + wait + "\n",
			want: "`if:` of its own",
		},
		"or true": {
			step: "      - run: " + wait + " || true\n",
			want: "swallows",
		},
		"or colon": {
			// Quoted: a bare `|| :` is invalid YAML in a plain scalar.
			step: "      - run: '" + wait + " || :'\n",
			want: "swallows",
		},
		"semicolon true": {
			step: "      - run: " + wait + "; true\n",
			want: "swallows",
		},
		"or exit 0": {
			step: "      - run: " + wait + " || exit 0\n",
			want: "swallows",
		},
		"set +e": {
			step: "      - run: |\n          set +e\n          " + wait + "\n",
			want: "swallows",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			broken := strings.Replace(goodPRReviewBotWorkflow, prReviewBotWaitStep, tc.step, 1)
			require.NotEqual(t, goodPRReviewBotWorkflow, broken)

			problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, broken))

			require.NoError(t, err)
			assert.Contains(t, strings.Join(problems, "\n"), tc.want)
		})
	}
}

// @scenario "The review does not start when a required check failed"
func TestPRReviewBotRequiresTheBotStepAfterTheWait(t *testing.T) {
	botAt := strings.Index(goodPRReviewBotWorkflow, "      - uses: langwatch")
	require.GreaterOrEqual(t, botAt, 0)
	broken := goodPRReviewBotWorkflow[:botAt]

	problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, broken))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "has no langwatch/langwatch-pr-review-bot@ step after the wait")
}

// @scenario "Review does not run on other pull request event types"
func TestPRReviewBotLimitsTheJobToTheFourEventTypes(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow,
		`      contains(fromJSON('["opened","synchronize","reopened","ready_for_review"]'), github.event.action) &&`+"\n", "", 1)
	require.NotEqual(t, goodPRReviewBotWorkflow, broken)
	root := writePRReviewBotWorkflow(t, broken)

	problems, err := ciguard.PRReviewBot(root)

	require.NoError(t, err)
	require.NotEmpty(t, problems)
	assert.Contains(t, strings.Join(problems, "\n"), "event type")
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

// @scenario "The review workflow grants exactly actions read, checks read, contents write and pull-requests write"
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

// The extra-key message lists every required key, so it never tells a reader
// to drop a grant the guard then reports as missing.
// @scenario "The review workflow grants exactly actions read, checks read, contents write and pull-requests write"
func TestPRReviewBotExtraPermissionMessageNamesEveryRequiredKey(t *testing.T) {
	withExtra := strings.Replace(goodPRReviewBotWorkflow,
		"      pull-requests: write",
		"      pull-requests: write\n      issues: write", 1)
	require.NotEqual(t, goodPRReviewBotWorkflow, withExtra, "the mutation must apply")

	problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, withExtra))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "only actions, checks, contents, pull-requests are needed")
}

// @scenario "The review workflow grants exactly actions read, checks read, contents write and pull-requests write"
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
		"      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n",
		"      - uses: ./.github/actions/go-build-cache\n"+
			"      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n", 1)
	require.NotEqual(t, goodPRReviewBotWorkflow, withLocalAction, "the mutation must apply")
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
	require.NotEqual(t, goodPRReviewBotWorkflow, quoted, "the mutation must apply")
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
	require.NotEqual(t, goodPRReviewBotWorkflow, repeated, "the mutation must apply")
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

// @scenario "A slow CI fails the wait with its own message, not the job timeout"
func TestPRReviewBotRejectsAWaitStepWithoutTimeout(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "        timeout-minutes: 50\n", "", 1)
	require.NotEqual(t, goodPRReviewBotWorkflow, broken, "the mutation must apply")

	problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, broken))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "wait step has no whole-number timeout-minutes")
}

// @scenario "A slow CI fails the wait with its own message, not the job timeout"
func TestPRReviewBotRejectsABotStepWithoutReviewTimeoutMinutes(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "          review_timeout_minutes: 20\n", "", 1)
	require.NotEqual(t, goodPRReviewBotWorkflow, broken, "the mutation must apply")

	problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, broken))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "no whole-number review_timeout_minutes")
}

// The job must cover the wait step plus both of the bot's claude calls plus 5.
// @scenario "A slow CI fails the wait with its own message, not the job timeout"
func TestPRReviewBotRejectsAJobTimeoutBelowTheWaitPlusTwiceTheReviewTimeout(t *testing.T) {
	for limit, wantProblem := range map[string]bool{"94": true, "95": false, "60": true} {
		t.Run(limit, func(t *testing.T) {
			changed := strings.Replace(goodPRReviewBotWorkflow,
				"    timeout-minutes: 100\n", "    timeout-minutes: "+limit+"\n", 1)
			require.NotEqual(t, goodPRReviewBotWorkflow, changed, "the mutation must apply")

			problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, changed))

			require.NoError(t, err)
			if wantProblem {
				assert.Contains(t, strings.Join(problems, "\n"), "leaves no room for the review: want at least 95")
			} else {
				assert.Empty(t, problems)
			}
		})
	}
}

// @scenario "A slow CI fails the wait with its own message, not the job timeout"
func TestPRReviewBotRejectsAReviewJobWithoutTimeout(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, "    timeout-minutes: 100\n", "", 1)
	require.NotEqual(t, goodPRReviewBotWorkflow, broken, "the mutation must apply")

	problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, broken))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "review job has no whole-number timeout-minutes")
}

// prReviewBotWakeKeyLine is the wake step's own env entry for the secret.
const prReviewBotWakeKeyLine = "          LAZE_WAKE_KEY: ${{ secrets.LAZE_WAKE_KEY }}\n"

// reviewBotProblems runs the guard on a mutated good workflow; it fails the test when the
// mutation did not apply.
func reviewBotProblems(t *testing.T, broken string) string {
	t.Helper()
	require.NotEqual(t, goodPRReviewBotWorkflow, broken, "the mutation must apply")

	problems, err := ciguard.PRReviewBot(writePRReviewBotWorkflow(t, broken))
	require.NoError(t, err)

	return strings.Join(problems, "\n")
}

// @scenario "The Laze wake runs after the wait and before the bot"
func TestPRReviewBotWakesAfterTheWaitAndBeforeTheBot(t *testing.T) {
	cases := map[string]struct{ broken, want string }{
		"before the wait": {
			broken: strings.Replace(goodPRReviewBotWorkflow,
				prReviewBotWaitStep+prReviewBotWakeStep, prReviewBotWakeStep+prReviewBotWaitStep, 1),
			want: "wakes the Laze review bot before the wait",
		},
		"after the bot": {
			broken: strings.Replace(goodPRReviewBotWorkflow, prReviewBotWakeStep, "", 1) + prReviewBotWakeStep,
			want:   "wakes the Laze review bot after the bot step",
		},
		"missing": {
			broken: strings.Replace(goodPRReviewBotWorkflow, prReviewBotWakeStep, "", 1),
			want:   "has no step posting to https://laze.so/api/agents/me/messages",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Contains(t, reviewBotProblems(t, tc.broken), tc.want)
		})
	}
}

// A step's `if:` cannot read that step's own env, so the skip has to live in the script.
// @scenario "The Laze wake skips when its secret is empty"
func TestPRReviewBotWakeSkipsInItsScript(t *testing.T) {
	skip := `[ -n "$LAZE_WAKE_KEY" ] || { echo "LAZE_WAKE_KEY not set; skipping wake"; exit 0; }`
	cases := map[string]struct{ broken, want string }{
		"no skip line": {
			broken: strings.Replace(goodPRReviewBotWorkflow, "          "+skip+"\n", "", 1),
			want:   "write the skip exactly as: " + skip,
		},
		"another shape": {
			broken: strings.Replace(goodPRReviewBotWorkflow, skip, `if [ -z "$LAZE_WAKE_KEY" ]; then exit 0; fi`, 1),
			want:   "write the skip exactly as: " + skip,
		},
		"if on the key": {
			broken: strings.Replace(goodPRReviewBotWorkflow,
				"      - name: Wake the Laze review bot\n",
				"      - name: Wake the Laze review bot\n        if: env.LAZE_WAKE_KEY != ''\n", 1),
			want: "an `if:` cannot see",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Contains(t, reviewBotProblems(t, tc.broken), tc.want)
		})
	}
}

// @scenario "The Laze wake can never fail the review job"
func TestPRReviewBotWakeCannotFailTheJob(t *testing.T) {
	cases := map[string]string{
		"unset": "",
		"false": "        continue-on-error: false\n",
	}
	for name, replacement := range cases {
		t.Run(name, func(t *testing.T) {
			broken := strings.Replace(goodPRReviewBotWorkflow, "        continue-on-error: true\n", replacement, 1)

			assert.Contains(t, reviewBotProblems(t, broken), "does not set continue-on-error: true")
		})
	}
}

// continue-on-error does not end a hung post; only the step's own timeout does.
// @scenario "The Laze wake can never fail the review job"
func TestPRReviewBotWakeHasAShortTimeout(t *testing.T) {
	cases := map[string]string{
		"unset":      "",
		"too long":   "        timeout-minutes: 10\n",
		"expression": "        timeout-minutes: ${{ vars.WAKE_TIMEOUT }}\n",
	}
	for name, replacement := range cases {
		t.Run(name, func(t *testing.T) {
			broken := strings.Replace(goodPRReviewBotWorkflow, "        timeout-minutes: 2\n", replacement, 1)

			assert.Contains(t, reviewBotProblems(t, broken), "wake step has no whole-number timeout-minutes of at most 5")
		})
	}
}

// Defense in depth, not isolation: steps share a runner, so this keeps the chat:post key out
// of every env, input and script but the wake step's.
// @scenario "The Laze wake key is scoped to the wake step"
func TestPRReviewBotScopesTheWakeKeyToTheWakeStep(t *testing.T) {
	keyOnTheJob := strings.Replace(goodPRReviewBotWorkflow, prReviewBotWakeKeyLine, "", 1)
	keyOnTheJob = strings.Replace(keyOnTheJob, "    steps:\n",
		"    env:\n      LAZE_WAKE_KEY: ${{ secrets.LAZE_WAKE_KEY }}\n    steps:\n", 1)
	cases := map[string]struct {
		broken string
		want   []string
	}{
		"job env, as pr.yml had it": {
			broken: keyOnTheJob,
			want:   []string{"job env carries LAZE_WAKE_KEY", "own env"},
		},
		"workflow env": {
			broken: strings.Replace(goodPRReviewBotWorkflow, "jobs:\n",
				"env:\n  LAZE_WAKE_KEY: ${{ secrets.LAZE_WAKE_KEY }}\n\njobs:\n", 1),
			want: []string{"workflow env carries LAZE_WAKE_KEY"},
		},
		"bot step env": {
			broken: strings.Replace(goodPRReviewBotWorkflow,
				"        with:\n          slack_notify:",
				"        env:\n"+prReviewBotWakeKeyLine+"        with:\n          slack_notify:", 1),
			want: []string{"langwatch/langwatch-pr-review-bot@", "is handed LAZE_WAKE_KEY"},
		},
		"bot step input": {
			broken: strings.Replace(goodPRReviewBotWorkflow,
				"          slack_notify: \"false\"\n",
				"          slack_notify: \"false\"\n          laze_key: ${{ secrets.LAZE_WAKE_KEY }}\n", 1),
			want: []string{"langwatch/langwatch-pr-review-bot@", "is handed LAZE_WAKE_KEY"},
		},
		"another step's script": {
			broken: strings.Replace(goodPRReviewBotWorkflow,
				"          go-version-file: go.work\n",
				"          go-version-file: go.work\n      - run: echo '${{ secrets.LAZE_WAKE_KEY }}'\n", 1),
			want: []string{`"echo '${{ secrets.LAZE_WAKE_KEY }}'" is handed LAZE_WAKE_KEY`},
		},
		"another step's if": {
			broken: strings.Replace(goodPRReviewBotWorkflow,
				"      - uses: langwatch/langwatch-pr-review-bot@",
				"      - if: secrets.LAZE_WAKE_KEY != ''\n        uses: langwatch/langwatch-pr-review-bot@", 1),
			want: []string{"langwatch/langwatch-pr-review-bot@", "is handed LAZE_WAKE_KEY"},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			problems := reviewBotProblems(t, tc.broken)
			for _, want := range tc.want {
				assert.Contains(t, problems, want)
			}
		})
	}
}

// toJSON(secrets) hands a step every secret the job can reach, the wake key included.
// @scenario "The Laze wake key is scoped to the wake step"
func TestPRReviewBotRejectsAStepPassingEverySecret(t *testing.T) {
	cases := map[string]struct{ broken, want string }{
		"another job's script": {
			broken: goodPRReviewBotWorkflow + `  dump:
    runs-on: ubuntu-latest
    steps:
      - run: echo '${{ toJSON(secrets) }}'
`,
			want: `job "dump" step "echo '${{ toJSON(secrets) }}'" passes toJSON(secrets)`,
		},
		"the bot's input": {
			broken: strings.Replace(goodPRReviewBotWorkflow,
				"          slack_notify: \"false\"\n",
				"          slack_notify: \"false\"\n          all: ${{ tojson( secrets ) }}\n", 1),
			want: `job "review" step "langwatch/langwatch-pr-review-bot@`,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			problems := reviewBotProblems(t, tc.broken)

			assert.Contains(t, problems, tc.want)
			assert.Contains(t, problems, "passes toJSON(secrets)")
		})
	}
}

// Laze mentions are plain text; without one the bot is never woken.
// @scenario "The Laze wake message mentions the review bot"
func TestPRReviewBotWakeMentionsTheBot(t *testing.T) {
	broken := strings.Replace(goodPRReviewBotWorkflow, `"@LangWatch PR Review Bot review `, `"review `, 1)

	assert.Contains(t, reviewBotProblems(t, broken), "does not mention @LangWatch PR Review Bot")
}

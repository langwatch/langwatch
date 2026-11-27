package ciguard

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

const goodPlaywrightAction = `runs:
  using: composite
  steps:
    - name: Install Chromium and its system packages
      id: playwright-install
      shell: bash
      run: |
        install() {
          sudo timeout 90 apt-get -o Acquire::Retries=3 update \
            || echo "::warning::apt-get update failed"
          timeout 600 pnpm --filter @langwatch/docs-site exec playwright install --with-deps chromium
        }
        install || { echo "::warning::retrying"; sleep 30; install; }
`

const goodPlaywrightWorkflow = `on: push
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 35
    steps:
      - uses: ./.github/actions/playwright-chromium
`

func playwrightProblems(t *testing.T, action, workflow string) []string {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{playwrightAction: action, ".github/workflows/docs.yml": workflow}
	for rel, body := range files {
		path := filepath.Join(root, rel)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
		require.NoError(t, os.WriteFile(path, []byte(body), 0o600))
	}
	problems, err := PlaywrightChromiumProblems(root)
	require.NoError(t, err)
	return problems
}

func TestPlaywrightChromiumHoldsOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := PlaywrightChromiumProblems(root)
	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "Each attempt refreshes the apt index under a timeout before installing"
func TestPlaywrightAttemptRefreshesAndInstallsUnderTimeouts(t *testing.T) {
	assert.Empty(t, playwrightProblems(t, goodPlaywrightAction, goodPlaywrightWorkflow))

	noRefreshTimeout := strings.Replace(goodPlaywrightAction, "sudo timeout 90 apt-get", "sudo apt-get", 1)
	noInstallTimeout := strings.Replace(goodPlaywrightAction, "timeout 600 pnpm", "pnpm", 1)
	shortInstall := strings.Replace(goodPlaywrightAction, "timeout 600 pnpm", "timeout 300 pnpm", 1)
	noStep := strings.Replace(goodPlaywrightAction, "id: playwright-install", "id: other", 1)

	assert.Contains(t, strings.Join(playwrightProblems(t, noRefreshTimeout, goodPlaywrightWorkflow), "\n"), "apt index")
	assert.Contains(t, strings.Join(playwrightProblems(t, noInstallTimeout, goodPlaywrightWorkflow), "\n"), "under a timeout")
	assert.Contains(t, strings.Join(playwrightProblems(t, noStep, goodPlaywrightWorkflow), "\n"), "missing")
	assert.Contains(t, strings.Join(playwrightProblems(t, shortInstall, goodPlaywrightWorkflow), "\n"), "slow mirror")
}

// @scenario "A failed index refresh still runs the install"
func TestPlaywrightFailedRefreshStillInstalls(t *testing.T) {
	unhandled := strings.Replace(goodPlaywrightAction, " \\\n            || echo \"::warning::apt-get update failed\"", "", 1)
	sameLine := strings.Replace(goodPlaywrightAction, " \\\n            ||", " ||", 1)

	assert.NotEqual(t, goodPlaywrightAction, unhandled)
	assert.Contains(t, strings.Join(playwrightProblems(t, unhandled, goodPlaywrightWorkflow), "\n"), "errexit")
	assert.Empty(t, playwrightProblems(t, sameLine, goodPlaywrightWorkflow))
}

// @scenario "A failed install is retried once after a pause"
func TestPlaywrightFailedInstallRetriesOnce(t *testing.T) {
	noRetry := strings.Replace(goodPlaywrightAction, `install || { echo "::warning::retrying"; sleep 30; install; }`, "install", 1)
	noPause := strings.Replace(goodPlaywrightAction, "sleep 30; ", "", 1)

	assert.Contains(t, strings.Join(playwrightProblems(t, noRetry, goodPlaywrightWorkflow), "\n"), "retried")
	assert.Contains(t, strings.Join(playwrightProblems(t, noPause, goodPlaywrightWorkflow), "\n"), "retried")
}

// @scenario "Every job using the action has a budget that covers the install's worst case"
func TestPlaywrightJobBudgetCoversTheInstall(t *testing.T) {
	noJobTimeout := strings.Replace(goodPlaywrightWorkflow, "    timeout-minutes: 35\n", "", 1)
	jobTooShort := strings.Replace(goodPlaywrightWorkflow, "timeout-minutes: 35", "timeout-minutes: 23", 1)

	subdir := strings.Replace(jobTooShort, "uses: ./.github/actions/playwright-chromium", "uses: ./head/.github/actions/playwright-chromium", 1)

	assert.NotEqual(t, goodPlaywrightWorkflow, noJobTimeout)
	assert.NotEqual(t, jobTooShort, subdir)
	assert.Contains(t, strings.Join(playwrightProblems(t, goodPlaywrightAction, subdir), "\n"), "cannot cover")
	assert.Contains(t, strings.Join(playwrightProblems(t, goodPlaywrightAction, noJobTimeout), "\n"), "no numeric timeout-minutes")
	assert.Contains(t, strings.Join(playwrightProblems(t, goodPlaywrightAction, jobTooShort), "\n"), "cannot cover")
}

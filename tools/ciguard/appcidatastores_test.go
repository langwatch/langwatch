package ciguard

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

func TestAppCIDatastoresHoldsOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := AppCIDatastores(root)
	require.NoError(t, err)
	assert.Empty(t, problems)
}

// appCIProblems runs the guard over a tree whose app CI workflow is the given text.
func appCIProblems(t *testing.T, workflow string) []string {
	t.Helper()
	root := t.TempDir()
	for _, rel := range AppCIWorkflows {
		body := "jobs:\n  ok:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n"
		if rel == AppCIWorkflows[0] {
			body = workflow
		}
		path := filepath.Join(root, rel)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
		require.NoError(t, os.WriteFile(path, []byte(body), 0o600))
	}
	problems, err := AppCIDatastores(root)
	require.NoError(t, err)

	return problems
}

// @scenario "The app CI jobs declare no services block"
func TestAppCIJobsDeclareNoServicesBlock(t *testing.T) {
	problems := appCIProblems(t, `jobs:
  suites:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:alpine
      postgres:
        image: postgres:16
    steps:
      - run: echo
`)

	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], `job "suites" declares services: postgres, redis`)
}

// @scenario "Every step that runs after a failure, and every container wait, has its own time limit"
func TestStepsAfterAFailureAndContainerWaitsHaveTheirOwnTimeLimit(t *testing.T) {
	problems := appCIProblems(t, `jobs:
  suites:
    runs-on: ubuntu-latest
    steps:
      - name: Wait for Postgres
        uses: ./.github/actions/wait-for-containers
      - name: Run the suites
        run: echo
      - name: Upload the report
        if: always()
        uses: actions/upload-artifact@v7
      - name: Notify on failure
        if: failure() && github.ref == 'refs/heads/main'
        run: echo
      - name: Bounded cleanup
        if: always()
        timeout-minutes: 2
        run: echo
      - name: Report unless cancelled
        if: ${{ !cancelled() }}
        run: echo
`)

	assert.ElementsMatch(t, []string{
		`.github/workflows/langwatch-app-ci.yml job "suites": step "Wait for Postgres" needs its own timeout-minutes`,
		`.github/workflows/langwatch-app-ci.yml job "suites": step "Upload the report" needs its own timeout-minutes`,
		`.github/workflows/langwatch-app-ci.yml job "suites": step "Notify on failure" needs its own timeout-minutes`,
	}, problems)
}

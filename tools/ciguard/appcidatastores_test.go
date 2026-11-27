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

// @scenario "Every datastore started in the background is waited for before a step reads it"
func TestBackgroundContainersAreWaitedForBeforeAStepReadsThem(t *testing.T) {
	problems := appCIProblems(t, `jobs:
  waited:
    runs-on: ubuntu-latest
    steps:
      - run: |
          { docker run -d --name postgres postgres:16 & docker run -d --name redis redis:alpine & wait; } > log 2>&1 &
      - uses: actions/checkout@v6
      - run: pnpm run ensure:built
      - timeout-minutes: 5
        run: go run ./cmd/waitcontainers -start-log "$RUNNER_TEMP/datastores.log" -timeout 240s postgres redis
      - run: pnpm task upgrade
  unwaited:
    runs-on: ubuntu-latest
    steps:
      - name: Start the datastores
        run: |
          docker run -d --name postgres postgres:16 &
          docker run --detach \
            --name=clickhouse clickhouse/clickhouse-server &
      - name: Upgrade
        run: pnpm start:prepare:db
      - name: Wait for Postgres
        timeout-minutes: 5
        run: go run ./cmd/waitcontainers -timeout 240s postgres
      - name: Suites
        run: pnpm --filter e2e test:unit
`)

	assert.ElementsMatch(t, []string{
		`.github/workflows/langwatch-app-ci.yml job "unwaited": step "Upgrade" reads the datastores started by step "Start the datastores" before a go run ./cmd/waitcontainers step`,
		`.github/workflows/langwatch-app-ci.yml job "unwaited": container "clickhouse" starts in the background but no later go run ./cmd/waitcontainers step names it`,
	}, problems)
}

// @scenario "Every step that runs after a failure, and every container wait, has its own time limit"
func TestStepsAfterAFailureAndContainerWaitsHaveTheirOwnTimeLimit(t *testing.T) {
	problems := appCIProblems(t, `jobs:
  suites:
    runs-on: ubuntu-latest
    steps:
      - name: Wait for Postgres
        run: go run ./cmd/waitcontainers postgres
      - name: Wait for Redis, spaced
        run: go  run   ./cmd/waitcontainers redis
      - name: Mention the waiter
        run: echo "Use go run ./cmd/waitcontainers for debugging"
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
      - name: Clean up a cancelled run
        if: cancelled()
        run: echo
      - if: always()
        run: |
          echo unnamed
          echo second line
`)

	assert.ElementsMatch(t, []string{
		`.github/workflows/langwatch-app-ci.yml job "suites": step "Wait for Postgres" needs its own timeout-minutes`,
		`.github/workflows/langwatch-app-ci.yml job "suites": step "Wait for Redis, spaced" needs its own timeout-minutes`,
		`.github/workflows/langwatch-app-ci.yml job "suites": step "Upload the report" needs its own timeout-minutes`,
		`.github/workflows/langwatch-app-ci.yml job "suites": step "Notify on failure" needs its own timeout-minutes`,
		`.github/workflows/langwatch-app-ci.yml job "suites": step "Clean up a cancelled run" needs its own timeout-minutes`,
		`.github/workflows/langwatch-app-ci.yml job "suites": step "echo unnamed" needs its own timeout-minutes`,
	}, problems)
}

func TestStepLabelFallsBackToThePosition(t *testing.T) {
	assert.Equal(t, "#3", stepLabel(&ciscan.Step{}, 2))
	assert.Equal(t, "actions/cache@v6", stepLabel(&ciscan.Step{Uses: "actions/cache@v6"}, 0))
}

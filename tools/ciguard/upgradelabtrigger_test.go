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

const goodGoCI = `on:
  pull_request:
    paths:
      - "**/*.go"
      - "modules/*/process/src/*.module.ts"
      - "enterprise/modules/*/process/src/*.module.ts"
      - "modules/*/process/src/migrations/*.ts"
      - "enterprise/modules/*/process/src/migrations/*.ts"
jobs:
  changes:
    outputs:
      go: ${{ steps.filter.outputs.go }}
      upgradelab: ${{ steps.filter.outputs.upgradelab || steps.force.outputs.go }}
    steps:
      - uses: dorny/paths-filter@ceb8a2b8f2d89434be7ff52d3de7ec3738c5cc9d # v4.0.3
        id: filter
        with:
          filters: |
            go:
              - '**/*.go'
            upgradelab:
              - 'modules/*/process/src/*.module.ts'
              - 'enterprise/modules/*/process/src/*.module.ts'
              - 'modules/*/process/src/migrations/*.ts'
              - 'enterprise/modules/*/process/src/migrations/*.ts'
  test:
    needs: changes
    if: ${{ needs.changes.outputs.go == 'true' && needs.changes.outputs.heavy == 'true' }}
  upgradelab:
    needs: changes
    if: ${{ needs.changes.outputs.upgradelab == 'true' && !(needs.changes.outputs.go == 'true' && needs.changes.outputs.heavy == 'true') }}
    steps:
      - run: go test -count=1 ./tools/upgradelab/...
`

func upgradelabProblems(t *testing.T, workflow string) []string {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, goCIWorkflow)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
	require.NoError(t, os.WriteFile(path, []byte(workflow), 0o600))
	problems, err := UpgradelabTrigger(root)
	require.NoError(t, err)
	return problems
}

func withoutLine(t *testing.T, workflow, line string) string {
	t.Helper()
	require.Contains(t, workflow, line+"\n")
	return strings.Replace(workflow, line+"\n", "", 1)
}

// @scenario "A pull request declaring a migration step runs upgradelab's coverage test"
func TestUpgradelabTriggerHoldsOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)
	problems, err := UpgradelabTrigger(root)
	require.NoError(t, err)
	assert.Empty(t, problems)
	assert.Empty(t, upgradelabProblems(t, goodGoCI))
}

// @scenario "A step-declaring path missing from go-ci's upgradelab filter is reported"
func TestUpgradelabTriggerReportsMissingGlobs(t *testing.T) {
	filter := withoutLine(t, goodGoCI, `              - 'modules/*/process/src/*.module.ts'`)
	assert.Equal(t, []string{goCIWorkflow + ": the upgradelab filter misses modules/*/process/src/*.module.ts, so the coverage test skips on it"},
		upgradelabProblems(t, filter))
}

// @scenario "A changes job that does not output the upgradelab filter is reported"
func TestUpgradelabTriggerReportsMissingOutput(t *testing.T) {
	workflow := withoutLine(t, goodGoCI, `      upgradelab: ${{ steps.filter.outputs.upgradelab || steps.force.outputs.go }}`)
	problems := upgradelabProblems(t, workflow)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "the changes job must output upgradelab")

	literal := strings.Replace(goodGoCI,
		"upgradelab: ${{ steps.filter.outputs.upgradelab || steps.force.outputs.go }}",
		"upgradelab: steps.filter.outputs.upgradelab || steps.force.outputs.go", 1)
	require.NotEqual(t, goodGoCI, literal)
	problems = upgradelabProblems(t, literal)
	require.Len(t, problems, 1, "an output that is a literal, not an expression, is reported")
}

// @scenario "An upgradelab job that skips while the full test job also skips is reported"
func TestUpgradelabTriggerReportsDraftGap(t *testing.T) {
	workflow := strings.Replace(goodGoCI,
		"!(needs.changes.outputs.go == 'true' && needs.changes.outputs.heavy == 'true')",
		"needs.changes.outputs.go != 'true'", 1)
	problems := upgradelabProblems(t, workflow)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "the upgradelab job's if must be")

	testGate := strings.Replace(goodGoCI,
		"if: ${{ needs.changes.outputs.go == 'true' && needs.changes.outputs.heavy == 'true' }}",
		"if: ${{ needs.changes.outputs.go == 'true' }}", 1)
	problems = upgradelabProblems(t, testGate)
	require.Len(t, problems, 1, "a test job gate the upgradelab job no longer negates is reported")
	assert.Contains(t, problems[0], "!(needs.changes.outputs.go == 'true')")

	extraGate := strings.Replace(goodGoCI,
		"&& needs.changes.outputs.heavy == 'true') }}",
		"&& needs.changes.outputs.heavy == 'true') && needs.changes.outputs.heavy == 'true' }}", 1)
	require.NotEqual(t, goodGoCI, extraGate)
	problems = upgradelabProblems(t, extraGate)
	require.Len(t, problems, 1, "an extra gate that skips drafts again is reported")

	stepGate := strings.Replace(goodGoCI,
		"      - run: go test -count=1 ./tools/upgradelab/...",
		"      - if: needs.changes.outputs.go == 'true'\n        run: go test -count=1 ./tools/upgradelab/...", 1)
	require.NotEqual(t, goodGoCI, stepGate)
	problems = upgradelabProblems(t, stepGate)
	require.Len(t, problems, 1, "a test step that skips on its own if is reported")
	assert.Contains(t, problems[0], "no if of its own")

	noRun := withoutLine(t, goodGoCI, "      - run: go test -count=1 ./tools/upgradelab/...")
	problems = upgradelabProblems(t, noRun)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "must run go test -count=1 ./tools/upgradelab/...")
}

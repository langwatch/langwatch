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

// realAppCI is this repository's workflow, the shape every broken copy starts from.
func realAppCI(t *testing.T) string {
	t.Helper()
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)
	raw, err := os.ReadFile(filepath.Join(root, ciguard.AppCIWorkflow))
	require.NoError(t, err)

	return string(raw)
}

func mainSuitesProblems(t *testing.T, workflow string) []string {
	t.Helper()
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, ".github", "workflows"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(root, ciguard.AppCIWorkflow), []byte(workflow), 0o600))
	problems, err := ciguard.MainSuites(root)
	require.NoError(t, err)

	return problems
}

func breakEach(t *testing.T, good string, cases map[string][2]string) {
	t.Helper()
	for name, swap := range cases {
		t.Run(name+" is refused", func(t *testing.T) {
			require.Contains(t, good, swap[0], "the fixture no longer holds the line this case breaks")
			assert.NotEmpty(t, mainSuitesProblems(t, strings.Replace(good, swap[0], swap[1], 1)))
		})
	}
}

// @scenario "A push to main runs the package suites as one job"
func TestMainRunsThePackageSuitesAsOneQueuedJob(t *testing.T) {
	good := realAppCI(t)
	t.Run("this repository's workflow passes", func(t *testing.T) {
		assert.Empty(t, mainSuitesProblems(t, good))
	})

	breakEach(t, good, map[string][2]string{
		"a main push that cuts short the run before it": {
			"cancel-in-progress: ${{ github.event_name != 'push' || github.ref != 'refs/heads/main' }}",
			"cancel-in-progress: true",
		},
		"no one-job output": {
			"suites-one-job: ${{ github.event_name == 'push' }}",
			"suites-one-job: ${{ false }}",
		},
		"eight shards on main": {
			"needs.changes.outputs.suites-one-job == 'true' && '[1]'",
			"needs.changes.outputs.suites-one-job == 'true' && '[1, 2, 3, 4, 5, 6, 7, 8]'",
		},
		"the 45-minute cap on main": {
			"timeout-minutes: ${{ needs.changes.outputs.suites-one-job == 'true' && 120 || 45 }}",
			"timeout-minutes: 45",
		},
		"a shard list shorter than its total": {
			"'[1, 2, 3, 4, 5, 6, 7, 8]'",
			"'[1, 2, 3, 4, 5, 6, 7]'",
		},
		"a total that miscounts the shards": {
			"'[1]' || '[8]'",
			"'[1]' || '[9]'",
		},
		"a fixed shard total": {
			"format('{0}/{1}', matrix.shard, matrix.total) || ''",
			"format('{0}/8', matrix.shard) || ''",
		},
		"a shard total that counts the browser leg": {
			"format('{0}/{1}', matrix.shard, matrix.total) || ''",
			"format('{0}/{1}', matrix.shard, strategy.job-total) || ''",
		},
		"eight shards counted on main": {
			"total: ${{ fromJSON(needs.changes.outputs.suites-one-job == 'true' && '[1]' || '[8]') }}",
			"total: [8]",
		},
		"no shared cache fallback": {
			"            ${{ runner.os }}-nx-suites-all-\n",
			"",
		},
	})
}

func TestMainSuitesReportsRatherThanFailsOnOtherLegalShapes(t *testing.T) {
	good := realAppCI(t)
	for name, swap := range map[string][2]string{
		"a scalar concurrency group": {
			"concurrency:\n",
			"concurrency: one-group\nx-old-concurrency:\n",
		},
		"a literal shard list": {
			"shard: ${{ fromJSON(needs.changes.outputs.suites-one-job == 'true' && '[1]' || '[1, 2, 3, 4, 5, 6, 7, 8]') }}",
			"shard: [1, 2, 3, 4, 5, 6, 7, 8]",
		},
		"a matrix that is one expression": {
			"matrix:\n        shard: ${{ fromJSON(needs.changes.outputs.suites-one-job == 'true' && '[1]' || '[1, 2, 3, 4, 5, 6, 7, 8]') }}\n",
			"matrix: ${{ fromJSON(needs.changes.outputs.suites-matrix) }}\n      x-old-matrix:\n",
		},
		"a numeric timeout": {
			"timeout-minutes: ${{ needs.changes.outputs.suites-one-job == 'true' && 120 || 45 }}",
			"timeout-minutes: 45",
		},
	} {
		t.Run(name+" is a problem, not an error", func(t *testing.T) {
			require.Contains(t, good, swap[0])
			assert.NotEmpty(t, mainSuitesProblems(t, strings.Replace(good, swap[0], swap[1], 1)))
		})
	}
}

// @scenario "Browser suites run on their own runner, never beside a suite that starts containers"
func TestBrowserSuitesRunOnALegOfTheirOwn(t *testing.T) {
	breakEach(t, realAppCI(t), map[string][2]string{
		"no browser leg": {
			"          - shard: browser\n            lanes: browser\n",
			"          - shard: extra\n",
		},
		"numbered legs that run browser suites too": {
			"        lanes: [no-browser]\n",
			"",
		},
		"a leg that runs every lane": {
			"          PACKAGE_SUITES_LANES: ${{ matrix.lanes }}\n",
			"",
		},
	})
}

// @scenario "A red package-suites run on main posts to Slack"
func TestARedOrTimedOutMainSuitesRunPostsToSlack(t *testing.T) {
	good := realAppCI(t)

	breakEach(t, good, map[string][2]string{
		"no Slack job": {
			`go run ./cmd/slacknotify -job-prefix`,
			"echo skipped",
		},
		"a timeout that does not post": {
			" || needs.package-suites.result == 'cancelled')",
			")",
		},
		"a Slack job that runs only on success": {
			"if: always() && github.event_name == 'push'",
			"if: github.event_name == 'push'",
		},
	})
}

// @scenario "A red main posts once per red package-suites leg"
func TestARedMainPostsOncePerRedLeg(t *testing.T) {
	breakEach(t, realAppCI(t), map[string][2]string{
		"one fixed leg name": {
			`go run ./cmd/slacknotify -job-prefix "package-suites ("`,
			`go run ./cmd/slacknotify -job "package-suites (1/1)"`,
		},
		"a prefix no leg is named with": {
			`-job-prefix "package-suites ("`,
			`-job-prefix "package suites ("`,
		},
		"no fallback when the lookup fails or finds no leg": {
			` -fallback-job "package-suites (1/1)"`,
			"",
		},
	})
}

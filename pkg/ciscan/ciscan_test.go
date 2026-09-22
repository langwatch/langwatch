package ciscan_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// LoadAll parses every workflow in the repo, so a single file that writes `on:`
// or `concurrency:` in one of GitHub's legal shorthand forms must not fail the
// load — modeling those keys as structs turned each shorthand into an unmarshal
// error that took down every guard. The shorthand yields no data, not an error.
func TestLoadAllToleratesWorkflowShorthand(t *testing.T) {
	const jobsBlock = "\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n"

	cases := []struct {
		name    string
		content string
		check   func(*testing.T, *ciscan.Workflow)
	}{
		{
			name:    "on sequence shorthand",
			content: "name: X\non: [push]" + jobsBlock,
			check: func(t *testing.T, w *ciscan.Workflow) {
				t.Helper()
				assert.Empty(t, w.On.PullRequest.Types)
			},
		},
		{
			name:    "on scalar shorthand",
			content: "name: X\non: push" + jobsBlock,
			check: func(t *testing.T, w *ciscan.Workflow) {
				t.Helper()
				assert.Empty(t, w.On.PullRequest.Types)
			},
		},
		{
			name:    "concurrency scalar shorthand",
			content: "name: X\non:\n  pull_request:\n    types: [opened]\nconcurrency: my-group" + jobsBlock,
			check: func(t *testing.T, w *ciscan.Workflow) {
				t.Helper()
				assert.Equal(t, []string{"opened"}, w.On.PullRequest.Types)
				assert.Empty(t, w.Concurrency.Group)
				assert.False(t, w.Concurrency.CancelsInProgress())
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			require.NoError(t, os.MkdirAll(filepath.Join(root, ciscan.WorkflowDir), 0o750))
			require.NoError(t, os.WriteFile(
				filepath.Join(root, ciscan.WorkflowDir, "wf.yml"), []byte(tc.content), 0o600))

			workflows, err := ciscan.LoadAll(root)

			require.NoError(t, err)
			require.Len(t, workflows, 1)
			tc.check(t, workflows[0])
		})
	}
}

func TestConcurrencyCancelsInProgress(t *testing.T) {
	cases := []struct {
		name  string
		value any
		want  bool
	}{
		{"unquoted true", true, true},
		{"unquoted false", false, false},
		{"quoted true", "true", true},
		{"quoted mixed case", "TRUE", true},
		{"quoted false", "false", false},
		{"typo reads as not canceling", "ture", false},
		{"absent key", nil, false},
		{"unexpected type", 1, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ciscan.Concurrency{CancelInProgress: tc.value}.CancelsInProgress()

			assert.Equal(t, tc.want, got)
		})
	}
}

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

func diffBaseProblems(t *testing.T, images string) []string {
	t.Helper()
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, ".github", "workflows"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(root, ciguard.ImagesWorkflow), []byte(images), 0o600)) //nolint:gosec // G703: a path under the test's own temp dir
	problems, err := ciguard.ECRDiffBase(root)
	require.NoError(t, err)

	return problems
}

// @scenario "A commit whose run was replaced while it waited still rebuilds what it changed"
// @scenario "An image published after the change set's start is rebuilt even when a revert empties the diff"
func TestTheImagesChangeSetStartsAtTheLastPublishedCommit(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)
	raw, err := os.ReadFile(filepath.Join(root, ciguard.ImagesWorkflow))
	require.NoError(t, err)
	workflow := string(raw)

	t.Run("this repository holds", func(t *testing.T) {
		assert.Empty(t, diffBaseProblems(t, workflow))
	})

	for name, breakIt := range map[string]func(string) string{
		"a paths filter with no base, which diffs the previous push": func(s string) string {
			return strings.Replace(s, "          base: ${{ steps.base.outputs.sha }}\n", "", 1)
		},
		"a base from the push event": func(s string) string {
			return strings.Replace(s, "base: ${{ steps.base.outputs.sha }}", "base: ${{ github.event.before }}", 1)
		},
		"a paths filter that runs without a base": func(s string) string {
			return strings.Replace(s, "        if: steps.base.outputs.sha != ''\n        id: filter", "        if: github.event_name == 'push'\n        id: filter", 1)
		},
		"no diffbase step": func(s string) string {
			return strings.Replace(s, "go run ./cmd/ecrtag diffbase", "go run ./cmd/ecrtag nearest", 1)
		},
		"a diffbase that skips an image create-manifest re-tags": func(s string) string {
			return strings.Replace(s, "            langwatch-app langwatch-nlp-service", "            langwatch-nlp-service", 1)
		},
		"a select step gated on the event, which builds nothing without a base": func(s string) string {
			return strings.Replace(s, "FILTERED: ${{ steps.base.outputs.sha != '' }}", "FILTERED: ${{ github.event_name == 'push' }}", 1)
		},
		"a rebuild list the base step never writes": func(s string) string {
			return strings.Replace(s, `echo "rebuild=${REBUILD}"`, `echo "rebuilt=${REBUILD}"`, 1)
		},
		"a select step that does not read the rebuild list": func(s string) string {
			return strings.Replace(s, "REBUILD: ${{ steps.base.outputs.rebuild }}", "REBUILD: '[]'", 1)
		},
		"a select step that drops the rebuild list": func(s string) string {
			return strings.Replace(s, "               + $rebuild | unique')", "               | unique')", 1)
		},
	} {
		t.Run(name+" fails", func(t *testing.T) {
			broken := breakIt(workflow)
			require.NotEqual(t, workflow, broken, "the sabotage must change the workflow")
			assert.NotEmpty(t, diffBaseProblems(t, broken))
		})
	}
}

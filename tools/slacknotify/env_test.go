package slacknotify_test

import (
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/slacknotify"
)

func TestWorkflowFileReadsTheFileFromTheRef(t *testing.T) {
	assert.Equal(t, "langwatch-app-ci.yml", slacknotify.WorkflowFile("langwatch/langwatch/.github/workflows/langwatch-app-ci.yml@refs/heads/main"))
	assert.Equal(t, "e2e-ci.yml", slacknotify.WorkflowFile("langwatch/langwatch/.github/workflows/e2e-ci.yml@refs/pull/9/merge"))
	assert.Empty(t, slacknotify.WorkflowFile(""))
}

func TestOrGitFallsBackToTheCheckedOutCommit(t *testing.T) {
	dir := t.TempDir()
	for _, args := range [][]string{
		{"init", "-q"},
		{"-c", "user.name=Someone", "-c", "user.email=s@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "fix: the subject\n\nbody"},
	} {
		require.NoError(t, exec.CommandContext(t.Context(), "git", append([]string{"-C", dir}, args...)...).Run()) //nolint:gosec // G204: fixed git arguments in a test
	}

	assert.Equal(t, "from the event", slacknotify.OrGit(t.Context(), dir, "from the event", "%s"))
	assert.Equal(t, "fix: the subject", slacknotify.OrGit(t.Context(), dir, "", "%s"))
	assert.Equal(t, "Someone", slacknotify.OrGit(t.Context(), dir, "", "%an"))
	assert.Equal(t, "unknown", slacknotify.OrGit(t.Context(), t.TempDir(), "", "%s"))
}

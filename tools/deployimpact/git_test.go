package deployimpact

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// repo makes a git repository with a first commit and a second that changes it.
func repo(t *testing.T) (dir string, base string, head string) {
	t.Helper()
	dir = t.TempDir()
	run := func(args ...string) string {
		cmd := exec.CommandContext(context.Background(), "git", append([]string{"-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"}, args...)...)
		cmd.Dir = dir
		out, err := cmd.CombinedOutput()
		require.NoError(t, err, string(out))
		return strings.TrimSpace(string(out))
	}
	write := func(path, content string) {
		require.NoError(t, os.MkdirAll(filepath.Dir(filepath.Join(dir, path)), 0o750))
		require.NoError(t, os.WriteFile(filepath.Join(dir, path), []byte(content), 0o600))
	}
	run("init", "-q")
	write(valuesFile, "app:\n  port: 1\n")
	write("apps/api/Dockerfile", "FROM a\n")
	run("add", "-A")
	run("commit", "-q", "-m", "base")
	base = run("rev-parse", "HEAD")
	write(valuesFile, "app:\n  port: 2\n")
	require.NoError(t, os.Remove(filepath.Join(dir, "apps/api/Dockerfile")))
	write("charts/langwatch/templates/a b.yaml", "kind: x\n")
	run("add", "-A")
	run("commit", "-q", "-m", "head")
	return dir, base, run("rev-parse", "HEAD")
}

func TestGitTreeReadsARevisionWithoutACheckout(t *testing.T) {
	dir, base, head := repo(t)
	t.Chdir(dir)
	ctx := context.Background()
	tree := GitTree{Ctx: ctx, Rev: head}

	paths, err := tree.Paths()
	require.NoError(t, err)
	assert.Equal(t, []string{"charts/langwatch/templates/a b.yaml", valuesFile}, paths)

	hits, err := tree.Grep(`port: [0-9]`)
	require.NoError(t, err)
	assert.Equal(t, []string{valuesFile}, hits, "the revision prefix is stripped")
	none, err := tree.Grep(`no such text`)
	require.NoError(t, err)
	assert.Empty(t, none, "no match is an empty list, not an error")

	content, err := tree.Read(valuesFile)
	require.NoError(t, err)
	assert.Equal(t, "app:\n  port: 2\n", content)
	absent, err := tree.Read("apps/api/Dockerfile")
	require.NoError(t, err)
	assert.Empty(t, absent, "a path absent at the revision reads empty")

	fork, err := MergeBase(ctx, base, head)
	require.NoError(t, err)
	assert.Equal(t, base, fork)

	changes, err := Changes(ctx, base, head)
	require.NoError(t, err)
	assert.ElementsMatch(t, []Change{
		{Status: "D", Path: "apps/api/Dockerfile"},
		{Status: "A", Path: "charts/langwatch/templates/a b.yaml"},
		{Status: "M", Path: valuesFile},
	}, changes)
}

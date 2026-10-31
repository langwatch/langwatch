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

func inputsProblems(t *testing.T, images string) []string {
	t.Helper()
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, ".github", "workflows"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(root, ciguard.ImagesWorkflow), []byte(images), 0o600)) //nolint:gosec // G703: a path under the test's own temp dir
	problems, err := ciguard.ECRInputs(root)
	require.NoError(t, err)

	return problems
}

// @scenario "A commit whose run was replaced while it waited still rebuilds what it changed"
func TestEveryImageIsPlannedFromItsInputs(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)
	raw, err := os.ReadFile(filepath.Join(root, ciguard.ImagesWorkflow))
	require.NoError(t, err)
	workflow := string(raw)

	t.Run("this repository holds", func(t *testing.T) {
		assert.Empty(t, inputsProblems(t, workflow))
	})

	for name, breakIt := range map[string]func(string) string{
		"a select step that does not plan with cmd/ecrtag": func(s string) string {
			return strings.Replace(s, "go run ./cmd/ecrtag select", "go run ./cmd/ecrtag plan", 1)
		},
		"a select step that leaves the build steps out": func(s string) string {
			return strings.Replace(s, "-workflow .github/workflows/publish-docker-ecr.yml ", "", 1)
		},
		"a build table missing an image create-manifest tags": func(s string) string {
			return strings.Replace(s, `{"image":"langwatch-eval-ragas",`, `{"name":"langwatch-eval-ragas",`, 1)
		},
		"a service build that does not record its inputs": func(s string) string {
			return strings.Replace(s, "            org.langwatch.inputs=${{ matrix.inputs }}\n", "", 1)
		},
		"a Lambda build that does not record its inputs": func(s string) string {
			i := strings.LastIndex(s, "            org.langwatch.inputs=${{ matrix.inputs }}\n")
			return s[:i] + s[i+len("            org.langwatch.inputs=${{ matrix.inputs }}\n"):]
		},
	} {
		t.Run(name+" fails", func(t *testing.T) {
			broken := breakIt(workflow)
			require.NotEqual(t, workflow, broken, "the sabotage must change the workflow")
			assert.NotEmpty(t, inputsProblems(t, broken))
		})
	}
}

// @scenario "An image whose inputs cannot be read is rebuilt"
func TestEveryImagesInputsCanBeRead(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := ciguard.ECRInputsReadable(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}

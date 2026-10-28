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

const goodTransformJob = `jobs:
  package-suites:
    steps:
      - name: Hash
        id: transform-inputs
        run: echo "hash=$(git ls-files -s -- pnpm-lock.yaml '*package.json' '*tsconfig*.json' | sha256sum)" >> "$GITHUB_OUTPUT"
      - name: Restore the vitest transforms
        uses: actions/cache@x
        with:
          path: node_modules/.vitest-cache
          key: ${{ runner.os }}-vitest-transforms-${{ matrix.shard }}-${{ steps.transform-inputs.outputs.hash }}-${{ github.sha }}
          restore-keys: ${{ runner.os }}-vitest-transforms-${{ matrix.shard }}-${{ steps.transform-inputs.outputs.hash }}-
      - name: Trim
        run: find node_modules/.vitest-cache -type f -mtime +7 -delete 2>/dev/null || true
`

func transformRepo(t *testing.T, workflow string) string {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, appCIWorkflow)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
	require.NoError(t, os.WriteFile(path, []byte(workflow), 0o600))
	return root
}

func transformProblems(t *testing.T, workflow string) []string {
	t.Helper()
	problems, err := TransformCacheProblems(transformRepo(t, workflow))
	require.NoError(t, err)
	return problems
}

func TestTransformCacheHoldsOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := TransformCacheProblems(root)
	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "The transform cache is restored only for the same inputs"
func TestTransformCacheRestoresOnlyTheSameInputs(t *testing.T) {
	t.Run("the shape above passes", func(t *testing.T) {
		assert.Empty(t, transformProblems(t, goodTransformJob))
	})

	for name, breakIt := range map[string]func(string) string{
		"a restore key without the inputs hash": func(s string) string {
			return strings.Replace(s, "restore-keys: ${{ runner.os }}-vitest-transforms-${{ matrix.shard }}-${{ steps.transform-inputs.outputs.hash }}-", "restore-keys: ${{ runner.os }}-vitest-transforms-${{ matrix.shard }}-", 1)
		},
		"a key without the inputs hash": func(s string) string {
			return strings.Replace(s, "-${{ steps.transform-inputs.outputs.hash }}-${{ github.sha }}", "-${{ github.sha }}", 1)
		},
		"a hash that leaves out the tsconfigs": func(s string) string {
			return strings.Replace(s, " '*tsconfig*.json'", "", 1)
		},
	} {
		t.Run(name+" is refused", func(t *testing.T) {
			assert.NotEmpty(t, transformProblems(t, breakIt(goodTransformJob)))
		})
	}
}

// @scenario "Each shard keeps its own transform cache, saved under its commit"
func TestTransformCacheIsPerShardAndPerCommit(t *testing.T) {
	noShard := strings.ReplaceAll(goodTransformJob, "${{ matrix.shard }}-", "")
	noCommit := strings.Replace(goodTransformJob, "-${{ github.sha }}", "", 1)

	assert.NotEmpty(t, transformProblems(t, noShard))
	assert.NotEmpty(t, transformProblems(t, noCommit))
}

// @scenario "Transforms no run has written for a week are dropped before the save"
func TestTransformCacheIsTrimmed(t *testing.T) {
	untrimmed := strings.Replace(goodTransformJob, "find node_modules/.vitest-cache -type f -mtime +7 -delete", "true", 1)

	problems := transformProblems(t, untrimmed)

	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "only grows")
}

func writePackage(t *testing.T, dir, scripts string, config bool) {
	t.Helper()
	require.NoError(t, os.MkdirAll(dir, 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"scripts": `+scripts+`}`), 0o600))
	if config {
		require.NoError(t, os.WriteFile(filepath.Join(dir, "vitest.config.ts"), []byte("export default {}\n"), 0o600))
	}
}

func TestEveryConfiglessVitestScriptOnThisRepositoryAsksForTheCache(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	missing, err := UncachedVitestScripts(root)
	require.NoError(t, err)
	assert.Empty(t, missing)
}

// @scenario "A suite that runs vitest without a config file asks for the transform cache"
func TestConfiglessVitestScriptsMustAskForTheCache(t *testing.T) {
	root := t.TempDir()
	writePackage(t, filepath.Join(root, "bare"), `{"test": "vitest run --exclude x", "test:integration": "vitest run --config vitest.integration.config.ts"}`, false)
	writePackage(t, filepath.Join(root, "flagged"), `{"test": "vitest run --fsModuleCache"}`, false)
	writePackage(t, filepath.Join(root, "configured"), `{"test": "vitest run"}`, true)
	writePackage(t, filepath.Join(root, "node_modules", "dep"), `{"test": "vitest run"}`, false)

	missing, err := UncachedVitestScripts(root)

	require.NoError(t, err)
	assert.Equal(t, []string{filepath.Join("bare", "package.json") + " test"}, missing)
}

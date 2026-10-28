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
        run: echo "hash=$(git ls-files -s -- pnpm-lock.yaml '*package.json' '*tsconfig*.json' packages/vitest-config | sha256sum)" >> "$GITHUB_OUTPUT"
      - name: Restore the vitest transforms
        uses: actions/cache@x
        with:
          path: node_modules/.vitest-cache
          key: ${{ runner.os }}-vitest-transforms-${{ matrix.shard }}-${{ steps.transform-inputs.outputs.hash }}-${{ github.sha }}
          restore-keys: ${{ runner.os }}-vitest-transforms-${{ matrix.shard }}-${{ steps.transform-inputs.outputs.hash }}-
      - name: Trim
        run: size=$(du -sm node_modules/.vitest-cache 2>/dev/null | cut -f1); if [ "${size:-0}" -gt 400 ]; then rm -rf node_modules/.vitest-cache && mkdir -p node_modules/.vitest-cache; fi
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
		"a hash that leaves out the shared vitest config": func(s string) string {
			return strings.Replace(s, " packages/vitest-config", "", 1)
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

// @scenario "A transform cache past its size limit is dropped whole before the save"
func TestTransformCacheIsBoundedBySize(t *testing.T) {
	unbounded := strings.Replace(goodTransformJob, "then rm -rf node_modules/.vitest-cache", "then true", 1)

	problems := transformProblems(t, unbounded)

	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "only grows")
}

// @scenario "A transform cache past its size limit is dropped whole before the save"
func TestTransformCacheTrimLeavesADirectoryToSave(t *testing.T) {
	removed := strings.Replace(goodTransformJob, " && mkdir -p node_modules/.vitest-cache", "", 1)

	problems := transformProblems(t, removed)

	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "only grows")
}

// @scenario "A transform cache past its size limit is dropped whole before the save"
func TestTransformCacheIsNeverPurgedByAge(t *testing.T) {
	aged := strings.Replace(goodTransformJob, "      - name: Trim\n",
		"      - name: Age\n        run: find node_modules/.vitest-cache -type f -mtime +7 -delete\n      - name: Trim\n", 1)

	problems := transformProblems(t, aged)

	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "by age")
}

func writePackage(t *testing.T, dir, scripts, config string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(dir, 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"scripts": `+scripts+`}`), 0o600))
	if config != "" {
		require.NoError(t, os.WriteFile(filepath.Join(dir, "vitest.config.ts"), []byte(config), 0o600))
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
	writePackage(t, filepath.Join(root, "bare"), `{"test": "vitest run --exclude x", "test:integration": "vitest run --config vitest.integration.config.ts"}`, "")
	writePackage(t, filepath.Join(root, "flagged"), `{"test": "vitest run --fsModuleCache"}`, "")
	writePackage(t, filepath.Join(root, "configured"), `{"test": "vitest run"}`, "export default { test: { fsModuleCache: true } }\n")
	writePackage(t, filepath.Join(root, "shared"), `{"test": "vitest run"}`, `import { defineModuleVitestConfig } from "@langwatch/vitest-config";`+"\n")
	writePackage(t, filepath.Join(root, "node_modules", "dep"), `{"test": "vitest run"}`, "")

	missing, err := UncachedVitestScripts(root)

	require.NoError(t, err)
	assert.Equal(t, []string{filepath.Join("bare", "package.json") + " test"}, missing)
}

// @scenario "A suite whose own vitest config does not persist transforms asks for the cache"
func TestHandRolledVitestConfigsMustAskForTheCache(t *testing.T) {
	root := t.TempDir()
	writePackage(t, filepath.Join(root, "handrolled"), `{"test": "vitest run"}`, "export default { test: {} }\n")

	missing, err := UncachedVitestScripts(root)

	require.NoError(t, err)
	assert.Equal(t, []string{filepath.Join("handrolled", "package.json") + " test"}, missing)
}

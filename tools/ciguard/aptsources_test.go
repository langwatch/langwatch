package ciguard

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

func TestAptUbuntuSourcesHoldsOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := AptUbuntuSourcesProblems(root)
	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "Only Ubuntu's own apt sources stay enabled"
func TestAptUbuntuSourcesDisablesThirdPartySources(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)
	step, err := loadAptSourcesStep(root)
	require.NoError(t, err)

	dir := t.TempDir()
	sources := filepath.Join(dir, "sources.list.d")
	disabled := filepath.Join(dir, "sources.disabled")
	files := map[string]string{
		"ubuntu.sources":      "Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: resolute\n\nTypes: deb\nURIs: http://security.ubuntu.com/ubuntu/\n",
		"microsoft-prod.list": "deb [arch=amd64] https://packages.microsoft.com/ubuntu/26.04/prod resolute main\n",
		"github-cli.sources":  "Types: deb\nURIs: https://cli.github.com/packages\nSuites: stable\n",
		"commented.list":      "# deb https://example.com/apt stable main\ndeb http://archive.ubuntu.com/ubuntu resolute main\n",
	}
	require.NoError(t, os.MkdirAll(sources, 0o750))
	for name, body := range files {
		require.NoError(t, os.WriteFile(filepath.Join(sources, name), []byte(body), 0o600))
	}

	cmd := exec.Command("bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", step.Run) //nolint:gosec // the repository's own action script, run against a temp directory
	cmd.Env = append(os.Environ(), "APT_SOURCES_DIR="+sources, "APT_DISABLED_DIR="+disabled)
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, string(out))

	assert.FileExists(t, filepath.Join(sources, "ubuntu.sources"))
	assert.FileExists(t, filepath.Join(sources, "commented.list"))
	assert.NoFileExists(t, filepath.Join(sources, "microsoft-prod.list"))
	assert.NoFileExists(t, filepath.Join(sources, "github-cli.sources"))
	assert.FileExists(t, filepath.Join(disabled, "microsoft-prod.list"))
	assert.FileExists(t, filepath.Join(disabled, "github-cli.sources"))
	assert.Contains(t, string(out), "microsoft-prod.list (https://packages.microsoft.com)")
	assert.Contains(t, string(out), "github-cli.sources (https://cli.github.com)")
	assert.NotContains(t, string(out), "ubuntu.sources")
	assert.NotContains(t, string(out), "commented.list")
}

func aptWorkflowProblems(t *testing.T, workflow string) []string {
	t.Helper()
	root := t.TempDir()
	action := "runs:\n  using: composite\n  steps:\n    - id: apt-ubuntu-sources\n      shell: bash\n      run: echo\n"
	browser := `{"scripts": {"test:browser": "playwright install --with-deps chromium && vitest run", "test": "vitest run"}}`
	files := map[string]string{aptSourcesAction: action, ".github/workflows/ci.yml": workflow, "modules/x/browser/package.json": browser}
	for rel, body := range files {
		path := filepath.Join(root, rel)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
		require.NoError(t, os.WriteFile(path, []byte(body), 0o600))
	}
	problems, err := AptUbuntuSourcesProblems(root)
	require.NoError(t, err)
	return problems
}

// @scenario "Every apt use runs after the shared action"
func TestAptUseRunsAfterTheSharedAction(t *testing.T) {
	good := `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: ./head/.github/actions/apt-ubuntu-sources
      - name: Tools
        run: sudo apt-get update && sudo apt-get install -y lsof
`
	aptFirst := strings.Replace(good, "      - uses: ./head/.github/actions/apt-ubuntu-sources\n", "", 1)
	playwright := strings.Replace(aptFirst, "sudo apt-get update && sudo apt-get install -y lsof", "pnpm exec playwright install --with-deps chromium", 1)
	browserCache := strings.Replace(aptFirst, `      - name: Tools
        run: sudo apt-get update && sudo apt-get install -y lsof`, `      - name: Cache the Playwright browser
        uses: actions/cache@v6
        with:
          path: ~/.cache/ms-playwright`, 1)

	packageSuites := strings.Replace(aptFirst, "sudo apt-get update && sudo apt-get install -y lsof", "node --experimental-strip-types .github/scripts/run-package-suites.ts", 1)
	browserScript := strings.Replace(aptFirst, "sudo apt-get update && sudo apt-get install -y lsof", "pnpm --filter @langwatch/x-browser test:browser", 1)
	plainTest := strings.Replace(aptFirst, "sudo apt-get update && sudo apt-get install -y lsof", "pnpm --filter @langwatch/x-browser test", 1)

	assert.Empty(t, aptWorkflowProblems(t, good))
	assert.Empty(t, aptWorkflowProblems(t, plainTest))
	for _, workflow := range []string{aptFirst, playwright, browserCache, packageSuites, browserScript} {
		assert.NotEqual(t, good, workflow)
		assert.Contains(t, strings.Join(aptWorkflowProblems(t, workflow), "\n"), "before ./.github/actions/apt-ubuntu-sources")
	}
}

package ciguard_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/ciguard"
)

var releaseLockSDK = ciguard.ReleasePackages[0]

func releaseLockEntry(lockName string) string {
	return `{"type":"toml","path":"/uv.lock","jsonpath":"$.package[?(@.name.value=='` + lockName + `')].version"}`
}

func releaseLockConfig(extraSDK, extraKsuid string) string {
	return `{"packages":{"sdks/python":{"extra-files":[` + extraSDK + `]},"packages/ksuid-python":{"extra-files":[` + extraKsuid + `]}}}`
}

func releaseLockBlock(name, version, path string) string {
	return "name = \"" + name + "\"\nversion = \"" + version + "\"\nsource = { editable = \"" + path + "\" }\n"
}

func releaseLockLock(blocks ...string) string {
	return "version = 1\n\n[[package]]\n" + strings.Join(blocks, "\n[[package]]\n")
}

func releaseLockPyproject(version string) string {
	return "[project]\nname = \"x\"\nversion = \"" + version + "\" # note\n"
}

const releaseLockRootPyproject = "[tool.uv.workspace]\nmembers = [\"sdks/python\", \"packages/ksuid-python\"]\n"

func releaseLockManifest(sdkVersion, ksuidVersion string) string {
	return `{"sdks/python":"` + sdkVersion + `","packages/ksuid-python":"` + ksuidVersion + `"}`
}

func releaseLockInStep() ciguard.ReleaseLockFiles {
	return ciguard.ReleaseLockFiles{
		Config:        releaseLockConfig(releaseLockEntry("langwatch"), releaseLockEntry("langwatch-ksuid")),
		Manifest:      releaseLockManifest("1.4.0", "1.0.1"),
		RootPyproject: releaseLockRootPyproject,
		Lock: releaseLockLock(
			releaseLockBlock("langwatch", "1.4.0", "sdks/python"),
			releaseLockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python"),
		),
		Pyprojects: map[string]string{"sdks/python": releaseLockPyproject("1.4.0"), "packages/ksuid-python": releaseLockPyproject("1.0.1")},
	}
}

func releaseLockProblemsOf(t *testing.T, files ciguard.ReleaseLockFiles) string {
	t.Helper()
	got, err := ciguard.ReleaseLockProblems(files)
	require.NoError(t, err)

	return strings.Join(got, "\n")
}

// @scenario "The release config bumps uv.lock"
func TestExtraFilesProblems(t *testing.T) {
	good := releaseLockEntry("langwatch")
	cases := map[string]struct {
		extra     string
		want      int
		advice    string
		notAdvice string
		found     string
	}{
		"entry present":   {extra: `"src/__version__.py",` + good},
		"entry missing":   {extra: `"src/__version__.py"`, want: 1, advice: "add the toml"},
		"other package":   {extra: releaseLockEntry("langwatch-ksuid"), want: 1, advice: "wrong jsonpath", notAdvice: "add the"},
		"entry duplicate": {extra: good + "," + good, want: 1, advice: "remove the extras"},
		"wrong jsonpath": {
			extra:     `{"type":"toml","path":"/uv.lock","jsonpath":"$.package[0].version"}`,
			want:      1,
			advice:    "$.package[?(@.name.value=='langwatch')].version",
			notAdvice: "add the",
			found:     "$.package[0].version",
		},
		"stray entry beside the right one": {
			extra:     good + `,{"type":"toml","path":"/uv.lock","jsonpath":"$.package[0].version"}`,
			want:      1,
			advice:    "wrong jsonpath",
			notAdvice: "add the",
			found:     "$.package[0].version",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			var cfg ciguard.ReleaseConfig
			require.NoError(t, json.Unmarshal([]byte(releaseLockConfig(tc.extra, "")), &cfg))

			got := ciguard.ReleaseExtraFilesProblems(cfg, releaseLockSDK)

			require.Len(t, got, tc.want)
			if tc.want > 0 {
				assert.Contains(t, got[0], tc.advice)
			}
			if tc.notAdvice != "" {
				assert.NotContains(t, got[0], tc.notAdvice)
			}
			if tc.found != "" {
				assert.Contains(t, got[0], tc.found)
			}
		})
	}
}

// @scenario "A lock behind the release version fails the check"
func TestLockBehindReleaseFails(t *testing.T) {
	t.Run("pyproject ahead of the lock", func(t *testing.T) {
		files := releaseLockInStep()
		files.Pyprojects["sdks/python"] = releaseLockPyproject("1.5.0")
		files.Manifest = releaseLockManifest("1.5.0", "1.0.1")

		got := releaseLockProblemsOf(t, files)

		for _, want := range []string{`lock "1.4.0"`, `pyproject "1.5.0"`, "uv lock"} {
			assert.Contains(t, got, want)
		}
	})
	t.Run("manifest ahead of pyproject and lock", func(t *testing.T) {
		files := releaseLockInStep()
		files.Manifest = releaseLockManifest("1.5.0", "1.0.1")

		got := releaseLockProblemsOf(t, files)

		for _, want := range []string{`"1.4.0"`, `"1.5.0"`, "cannot fix"} {
			assert.Contains(t, got, want)
		}
		assert.NotContains(t, got, "out of step", "drift must not be reported as a lock problem")
	})
	t.Run("lock ahead of pyproject with the manifest disagreeing", func(t *testing.T) {
		files := releaseLockInStep()
		files.Lock = releaseLockLock(releaseLockBlock("langwatch", "1.6.0", "sdks/python"), releaseLockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python"))
		files.Manifest = releaseLockManifest("1.5.0", "1.0.1")

		got := releaseLockProblemsOf(t, files)

		assert.Contains(t, got, `"1.5.0"`)
		assert.NotContains(t, got, "run `uv lock`")
	})
}

// @scenario "A lock in step passes"
func TestLockInStepPasses(t *testing.T) {
	assert.Empty(t, releaseLockProblemsOf(t, releaseLockInStep()))
}

// @scenario "A pyproject without a static project version fails the check"
func TestDynamicProjectVersionFails(t *testing.T) {
	files := releaseLockInStep()
	files.Pyprojects["sdks/python"] = "[project]\nname = \"langwatch\"\ndynamic = [\"version\"]\n"

	assert.Contains(t, releaseLockProblemsOf(t, files), "no static [project] version")
}

// @scenario "A ksuid-python release that leaves the lock behind fails the check"
func TestKsuidDriftFails(t *testing.T) {
	files := releaseLockInStep()
	files.Pyprojects["packages/ksuid-python"] = releaseLockPyproject("1.0.2")
	files.Manifest = releaseLockManifest("1.4.0", "1.0.2")

	got := releaseLockProblemsOf(t, files)

	assert.Contains(t, got, "uv.lock is out of step with packages/ksuid-python/pyproject.toml")
	assert.NotContains(t, got, "sdks/python")
}

// @scenario "A uv workspace member the guard does not check fails the check"
func TestUnlistedWorkspaceMemberFails(t *testing.T) {
	files := releaseLockInStep()
	files.RootPyproject = "[tool.uv.workspace]\nmembers = [\"sdks/python\", \"packages/ksuid-python\", \"packages/new\"]\n"

	assert.Contains(t, releaseLockProblemsOf(t, files), "packages/new")
}

func TestProblemsRejectsBadJSON(t *testing.T) {
	files := releaseLockInStep()
	files.Config = "{"

	_, err := ciguard.ReleaseLockProblems(files)

	require.Error(t, err)
}

// @scenario "The guard reads the repository files"
func TestCheckReadsRepositoryFiles(t *testing.T) {
	files := releaseLockInStep()
	repo := map[string]string{
		".github/release-please-config.json":    files.Config,
		".github/.release-please-manifest.json": files.Manifest,
		"pyproject.toml":                        files.RootPyproject,
		"uv.lock":                               files.Lock,
	}
	for path, content := range files.Pyprojects {
		repo[path+"/pyproject.toml"] = content
	}
	root := writeRepo(t, repo)

	got, err := ciguard.ReleaseLock(root)
	require.NoError(t, err)
	assert.Empty(t, got)

	require.NoError(t, os.WriteFile(filepath.Join(root, "uv.lock"), []byte(releaseLockLock(releaseLockBlock("langwatch", "1.3.0", "sdks/python"), releaseLockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python"))), 0o600))
	got, err = ciguard.ReleaseLock(root)
	require.NoError(t, err)
	assert.Len(t, got, 1)
}

func TestReleaseLockPassesOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := ciguard.ReleaseLock(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "Manifest drift is reported without lock advice"
func TestManifestDriftHasNoLockAdvice(t *testing.T) {
	files := releaseLockInStep()
	files.Pyprojects["sdks/python"] = releaseLockPyproject("1.5.0")

	got := releaseLockProblemsOf(t, files)

	assert.Contains(t, got, `"1.5.0"`)
	assert.Contains(t, got, `"1.4.0"`)
	assert.NotContains(t, got, "run `uv lock`")
	assert.NotContains(t, got, "out of step")
}

// @scenario "A package missing from the release manifest fails the check"
func TestMissingManifestKeyFails(t *testing.T) {
	files := releaseLockInStep()
	files.Manifest = `{"packages/ksuid-python":"1.0.1"}`

	got := releaseLockProblemsOf(t, files)

	assert.Contains(t, got, "no \"sdks/python\" key")
	assert.NotContains(t, got, "cannot fix")
}

// @scenario "A missing uv.lock entry fails with uv lock advice"
func TestMissingLockEntryAdvisesUvLock(t *testing.T) {
	files := releaseLockInStep()
	files.Lock = releaseLockLock(releaseLockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python"))

	got := releaseLockProblemsOf(t, files)

	assert.Contains(t, got, "no entry named langwatch")
	assert.Contains(t, got, "run `uv lock`")
}

// @scenario "A duplicate uv.lock entry fails without uv lock advice"
func TestDuplicateLockEntryOmitsUvLockAdvice(t *testing.T) {
	files := releaseLockInStep()
	files.Lock = releaseLockLock(releaseLockBlock("langwatch", "1.4.0", "sdks/python"), releaseLockBlock("langwatch", "1.4.0", "sdks/python"), releaseLockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python"))

	got := releaseLockProblemsOf(t, files)

	assert.Contains(t, got, "packages named langwatch")
	assert.NotContains(t, got, "run `uv lock`")
}

// @scenario "A non-editable uv.lock entry fails the check"
func TestNonEditableLockEntryFails(t *testing.T) {
	files := releaseLockInStep()
	files.Lock = releaseLockLock(releaseLockBlock("langwatch", "1.4.0", "elsewhere"), releaseLockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python"))

	got := releaseLockProblemsOf(t, files)

	assert.Contains(t, got, "not the editable sdks/python package")
	assert.NotContains(t, got, "run `uv lock`")
}

// @scenario "A multi-line workspace members list fails the check"
func TestMultiLineMembersFails(t *testing.T) {
	files := releaseLockInStep()
	files.RootPyproject = "[tool.uv.workspace]\nmembers = [\n  \"sdks/python\",\n  \"packages/ksuid-python\",\n]\n"

	assert.Contains(t, releaseLockProblemsOf(t, files), "no one-line")
}

// @scenario "A change to any file the release-lock guard reads runs the guard"
func TestReleaseLockRunsWhenAFileItReadsChanges(t *testing.T) {
	filters := goCIChangesFilters(t)

	for _, path := range ciguard.ReleaseLockInputPaths() {
		require.Contains(t, filters["ciguards"], path, "go-ci's ciguards filter must list %s", path)
	}
}

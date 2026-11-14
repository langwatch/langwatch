package releaselock_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/releaselock"
)

var sdk = releaselock.Packages[0]

func entry(lockName string) string {
	return `{"type":"toml","path":"/uv.lock","jsonpath":"$.package[?(@.name.value=='` + lockName + `')].version"}`
}

func config(extraSDK, extraKsuid string) string {
	return `{"packages":{"sdks/python":{"extra-files":[` + extraSDK + `]},"packages/ksuid-python":{"extra-files":[` + extraKsuid + `]}}}`
}

func lockBlock(name, version, path string) string {
	return "name = \"" + name + "\"\nversion = \"" + version + "\"\nsource = { editable = \"" + path + "\" }\n"
}

func lock(blocks ...string) string {
	return "version = 1\n\n[[package]]\n" + strings.Join(blocks, "\n[[package]]\n")
}

func pyproject(version string) string {
	return "[project]\nname = \"x\"\nversion = \"" + version + "\" # note\n"
}

const rootPyproject = "[tool.uv.workspace]\nmembers = [\"sdks/python\", \"packages/ksuid-python\"]\n"

func manifest(sdkVersion, ksuidVersion string) string {
	return `{"sdks/python":"` + sdkVersion + `","packages/ksuid-python":"` + ksuidVersion + `"}`
}

func inStep() releaselock.Files {
	return releaselock.Files{
		Config:        config(entry("langwatch"), entry("langwatch-ksuid")),
		Manifest:      manifest("1.4.0", "1.0.1"),
		RootPyproject: rootPyproject,
		Lock: lock(
			lockBlock("langwatch", "1.4.0", "sdks/python"),
			lockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python"),
		),
		Pyprojects: map[string]string{"sdks/python": pyproject("1.4.0"), "packages/ksuid-python": pyproject("1.0.1")},
	}
}

func problemsOf(t *testing.T, files releaselock.Files) string {
	t.Helper()
	got, err := releaselock.Problems(files)
	if err != nil {
		t.Fatal(err)
	}

	return strings.Join(got, "\n")
}

// @scenario "The release config bumps uv.lock"
func TestExtraFilesProblems(t *testing.T) {
	good := entry("langwatch")
	cases := map[string]struct {
		extra  string
		want   int
		advice string
	}{
		"entry present":   {`"src/__version__.py",` + good, 0, ""},
		"entry missing":   {`"src/__version__.py"`, 1, "add the toml"},
		"other package":   {entry("langwatch-ksuid"), 1, "add the toml"},
		"entry duplicate": {good + "," + good, 1, "remove the extras"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			var cfg releaselock.Config
			if err := json.Unmarshal([]byte(config(tc.extra, "")), &cfg); err != nil {
				t.Fatal(err)
			}
			if got := releaselock.ExtraFilesProblems(cfg, sdk); len(got) != tc.want || (tc.want > 0 && !strings.Contains(got[0], tc.advice)) {
				t.Fatalf("got %v; want %d problems advising %q", got, tc.want, tc.advice)
			}
		})
	}
}

// @scenario "A lock behind the release version fails the check"
func TestLockBehindReleaseFails(t *testing.T) {
	t.Run("pyproject ahead of the lock", func(t *testing.T) {
		files := inStep()
		files.Pyprojects["sdks/python"] = pyproject("1.5.0")
		files.Manifest = manifest("1.5.0", "1.0.1")
		got := problemsOf(t, files)
		for _, want := range []string{`lock "1.4.0"`, `pyproject "1.5.0"`, "uv lock"} {
			if !strings.Contains(got, want) {
				t.Fatalf("got %q, want it to contain %q", got, want)
			}
		}
	})
	t.Run("manifest ahead of pyproject and lock", func(t *testing.T) {
		files := inStep()
		files.Manifest = manifest("1.5.0", "1.0.1")
		got := problemsOf(t, files)
		for _, want := range []string{`"1.4.0"`, `"1.5.0"`, "cannot fix"} {
			if !strings.Contains(got, want) {
				t.Fatalf("got %q, want it to contain %q", got, want)
			}
		}
		if strings.Contains(got, "out of step") {
			t.Fatalf("drift must not be reported as a lock problem: %q", got)
		}
	})
	t.Run("lock ahead of pyproject with the manifest disagreeing", func(t *testing.T) {
		files := inStep()
		files.Lock = lock(lockBlock("langwatch", "1.6.0", "sdks/python"), lockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python"))
		files.Manifest = manifest("1.5.0", "1.0.1")
		got := problemsOf(t, files)
		if !strings.Contains(got, `"1.5.0"`) || strings.Contains(got, "run `uv lock`") {
			t.Fatalf("got %q, want the drift only, with no uv lock advice", got)
		}
	})
}

// @scenario "A lock in step passes"
func TestLockInStepPasses(t *testing.T) {
	if got := problemsOf(t, inStep()); got != "" {
		t.Fatalf("got %q, want no problems", got)
	}
}

// @scenario "A pyproject without a static project version fails the check"
func TestDynamicProjectVersionFails(t *testing.T) {
	files := inStep()
	files.Pyprojects["sdks/python"] = "[project]\nname = \"langwatch\"\ndynamic = [\"version\"]\n"
	if got := problemsOf(t, files); !strings.Contains(got, "no static [project] version") {
		t.Fatalf("got %q, want the no-static-version problem", got)
	}
}

// @scenario "A ksuid-python release that leaves the lock behind fails the check"
func TestKsuidDriftFails(t *testing.T) {
	files := inStep()
	files.Pyprojects["packages/ksuid-python"] = pyproject("1.0.2")
	files.Manifest = manifest("1.4.0", "1.0.2")
	got := problemsOf(t, files)
	if !strings.Contains(got, "uv.lock is out of step with packages/ksuid-python/pyproject.toml") || strings.Contains(got, "sdks/python") {
		t.Fatalf("got %q, want only the ksuid-python lock problem", got)
	}
}

// @scenario "A uv workspace member the guard does not check fails the check"
func TestUnlistedWorkspaceMemberFails(t *testing.T) {
	files := inStep()
	files.RootPyproject = "[tool.uv.workspace]\nmembers = [\"sdks/python\", \"packages/ksuid-python\", \"packages/new\"]\n"
	if got := problemsOf(t, files); !strings.Contains(got, "packages/new") {
		t.Fatalf("got %q, want the unchecked member named", got)
	}
}

func TestProblemsRejectsBadJSON(t *testing.T) {
	files := inStep()
	files.Config = "{"
	if _, err := releaselock.Problems(files); err == nil {
		t.Fatal("want an error for malformed config")
	}
}

// @scenario "The guard reads the repository files"
func TestCheckReadsRepositoryFiles(t *testing.T) {
	root := t.TempDir()
	files := inStep()
	write := func(rel, content string) {
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(".github/release-please-config.json", files.Config)
	write(".github/.release-please-manifest.json", files.Manifest)
	write("pyproject.toml", files.RootPyproject)
	write("uv.lock", files.Lock)
	for path, content := range files.Pyprojects {
		write(path+"/pyproject.toml", content)
	}
	if got, err := releaselock.Check(root); err != nil || len(got) != 0 {
		t.Fatalf("got %v, %v; want no problems", got, err)
	}
	write("uv.lock", lock(lockBlock("langwatch", "1.3.0", "sdks/python"), lockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python")))
	if got, err := releaselock.Check(root); err != nil || len(got) != 1 {
		t.Fatalf("got %v, %v; want one problem", got, err)
	}
}

// @scenario "Manifest drift is reported without lock advice"
func TestManifestDriftHasNoLockAdvice(t *testing.T) {
	files := inStep()
	files.Pyprojects["sdks/python"] = pyproject("1.5.0")
	got := problemsOf(t, files)
	if !strings.Contains(got, `"1.5.0"`) || !strings.Contains(got, `"1.4.0"`) || strings.Contains(got, "run `uv lock`") || strings.Contains(got, "out of step") {
		t.Fatalf("got %q, want the drift only", got)
	}
}

// @scenario "A package missing from the release manifest fails the check"
func TestMissingManifestKeyFails(t *testing.T) {
	files := inStep()
	files.Manifest = `{"packages/ksuid-python":"1.0.1"}`
	got := problemsOf(t, files)
	if !strings.Contains(got, "no \"sdks/python\" key") || strings.Contains(got, "cannot fix") {
		t.Fatalf("got %q, want the missing-key problem", got)
	}
}

// @scenario "A missing uv.lock entry fails with uv lock advice"
func TestMissingLockEntryAdvisesUvLock(t *testing.T) {
	files := inStep()
	files.Lock = lock(lockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python"))
	got := problemsOf(t, files)
	if !strings.Contains(got, "no entry named langwatch") || !strings.Contains(got, "run `uv lock`") {
		t.Fatalf("got %q, want the missing-entry problem with uv lock advice", got)
	}
}

// @scenario "A duplicate uv.lock entry fails without uv lock advice"
func TestDuplicateLockEntryOmitsUvLockAdvice(t *testing.T) {
	files := inStep()
	files.Lock = lock(lockBlock("langwatch", "1.4.0", "sdks/python"), lockBlock("langwatch", "1.4.0", "sdks/python"), lockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python"))
	got := problemsOf(t, files)
	if !strings.Contains(got, "packages named langwatch") || strings.Contains(got, "run `uv lock`") {
		t.Fatalf("got %q, want the count problem without uv lock advice", got)
	}
}

// @scenario "A non-editable uv.lock entry fails the check"
func TestNonEditableLockEntryFails(t *testing.T) {
	files := inStep()
	files.Lock = lock(lockBlock("langwatch", "1.4.0", "elsewhere"), lockBlock("langwatch-ksuid", "1.0.1", "packages/ksuid-python"))
	got := problemsOf(t, files)
	if !strings.Contains(got, "not the editable sdks/python package") || strings.Contains(got, "run `uv lock`") {
		t.Fatalf("got %q, want the non-editable problem without uv lock advice", got)
	}
}

// @scenario "A multi-line workspace members list fails the check"
func TestMultiLineMembersFails(t *testing.T) {
	files := inStep()
	files.RootPyproject = "[tool.uv.workspace]\nmembers = [\n  \"sdks/python\",\n  \"packages/ksuid-python\",\n]\n"
	if got := problemsOf(t, files); !strings.Contains(got, "no one-line") {
		t.Fatalf("got %q, want the members-list problem", got)
	}
}

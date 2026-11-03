package releaselock_test

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/releaselock"
)

const goodEntry = `{"type":"toml","path":"/uv.lock","jsonpath":"$.package[?(@.name.value=='langwatch')].version"}`

func config(extra string) string {
	return `{"packages":{"sdks/python":{"extra-files":[` + extra + `]}}}`
}

func lock(blocks ...string) string {
	return "version = 1\n\n[[package]]\n" + strings.Join(blocks, "\n[[package]]\n")
}

const (
	local     = "name = \"langwatch\"\nversion = \"1.4.0\"\nsource = { editable = \"sdks/python\" }\n"
	pyproject = "[project]\nname = \"langwatch\"\nversion = \"1.4.0\" # note\n"
)

// @scenario "The release config bumps uv.lock"
func TestExtraFilesProblems(t *testing.T) {
	cases := map[string]struct {
		extra string
		want  int
	}{
		"entry present":   {`"src/langwatch/__version__.py",` + goodEntry, 0},
		"entry missing":   {`"src/langwatch/__version__.py"`, 1},
		"wrong jsonpath":  {`{"type":"toml","path":"/uv.lock","jsonpath":"$.version"}`, 1},
		"relative path":   {`{"type":"toml","path":"uv.lock","jsonpath":"$.package[?(@.name.value=='langwatch')].version"}`, 1},
		"entry duplicate": {goodEntry + "," + goodEntry, 1},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := releaselock.ExtraFilesProblems(config(tc.extra))
			if err != nil || len(got) != tc.want {
				t.Fatalf("got %v, %v; want %d problems", got, err, tc.want)
			}
		})
	}
}

func TestLockProblems(t *testing.T) {
	other := "name = \"langwatch-scenario\"\nversion = \"0.1.0\"\n"
	cases := map[string]struct {
		lock, pyproject, manifest, want string
	}{
		"in step":           {lock(other, local), pyproject, "1.4.0", ""},
		"pyproject differs": {lock(local), strings.Replace(pyproject, "1.4.0", "1.5.0", 1), "1.4.0", "pyproject.toml"},
		"no static version": {lock(local), "[project]\nname = \"langwatch\"\ndynamic = [\"version\"]\n", "1.4.0", "no static [project] version"},
		"manifest differs":  {lock(local), pyproject, "1.5.0", "release manifest"},
		"no langwatch":      {lock(other), pyproject, "1.4.0", "0 packages"},
		"two langwatch":     {lock(local, local), pyproject, "1.4.0", "2 packages"},
		"not editable":      {lock("name = \"langwatch\"\nversion = \"1.4.0\"\n"), pyproject, "1.4.0", "not the editable"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got := strings.Join(releaselock.LockProblems(tc.lock, tc.pyproject, tc.manifest), "\n")
			if tc.want == "" && got != "" || !strings.Contains(got, tc.want) {
				t.Fatalf("got %q, want it to contain %q", got, tc.want)
			}
			if tc.want != "" && !strings.Contains(tc.want, "static") && !strings.Contains(got, "uv lock") {
				t.Fatalf("message gives no fix: %q", got)
			}
		})
	}
}

func TestProblemsRejectsBadJSON(t *testing.T) {
	if _, err := releaselock.Problems(releaselock.Files{Config: "{", Manifest: "{}", Pyproject: pyproject, Lock: lock(local)}); err == nil {
		t.Fatal("want an error for malformed config")
	}
}

// @scenario "A lock behind the release version fails the check"
func TestLockBehindReleaseFails(t *testing.T) {
	got := releaselock.LockProblems(lock(local), pyproject, "1.5.0")
	if len(got) != 1 || !strings.Contains(got[0], "uv lock") {
		t.Fatalf("got %v, want one problem with the uv lock instruction", got)
	}
}

// @scenario "A lock in step passes"
func TestLockInStepPasses(t *testing.T) {
	if got := releaselock.LockProblems(lock(local), pyproject, "1.4.0"); len(got) != 0 {
		t.Fatalf("got %v, want no problems", got)
	}
}

// @scenario "A pyproject without a static project version fails the check"
func TestDynamicProjectVersionFails(t *testing.T) {
	dynamic := "[project]\nname = \"langwatch\"\ndynamic = [\"version\"]\n"
	got := releaselock.LockProblems(lock(local), dynamic, "1.4.0")
	if len(got) != 1 || !strings.Contains(got[0], "no static [project] version") {
		t.Fatalf("got %v, want the no-static-version problem", got)
	}
}

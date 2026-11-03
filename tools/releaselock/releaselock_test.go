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
			if tc.want != "" && !strings.Contains(got, "uv lock") {
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

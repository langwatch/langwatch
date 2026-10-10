package devscripts

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/internal/collate"
)

func writeTree(t testing.TB, root string, tree map[string]string) {
	t.Helper()
	for path, content := range tree {
		full := filepath.Join(root, path)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func run(t testing.TB, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := Run(args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func TestLocaleCompare(t *testing.T) {
	for _, c := range localeCompareCases {
		if got := collate.Compare(c.a, c.b); got != c.want {
			t.Errorf("collate.Compare(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestStringifyJS(t *testing.T) {
	parsed, err := parseOrdered([]byte(`{"b":1,"a":{"x":[],"y":{},"z":["q\"\n\u0001<&>",null,true,1.50]}}`))
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n  \"b\": 1,\n  \"a\": {\n    \"x\": [],\n    \"y\": {},\n    \"z\": [\n      \"q\\\"\\n\\u0001<&>\",\n      null,\n      true,\n      1.50\n    ]\n  }\n}"
	if got := stringifyJS(parsed); got != want {
		t.Errorf("stringifyJS = %q, want %q", got, want)
	}
}

func TestContainsWord(t *testing.T) {
	cases := []struct {
		text, needle  string
		leading, want bool
	}{
		{"export const fooServer = 1", "fooServer", true, true},
		{"export const xfooServer = 1", "fooServer", true, false},
		{"export const fooServers = 1", "fooServer", true, false},
		{"xexport const fooServer;", "export const fooServer", false, true},
		{"a barServer, fooServer", "fooServer", true, true},
	}
	for _, c := range cases {
		if got := containsWord([]byte(c.text), c.needle, c.leading); got != c.want {
			t.Errorf("containsWord(%q, %q, %v) = %v, want %v", c.text, c.needle, c.leading, got, c.want)
		}
	}
}

func TestRenderReferences(t *testing.T) {
	for _, c := range renderReferencesCases {
		if got := RenderReferences(c.in, c.refs); got != c.want {
			t.Errorf("%s: RenderReferences =\n%q\nwant\n%q", c.name, got, c.want)
		}
	}
}

func TestGenerateModulesMatchesTheNodeScript(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, generateModulesFixture)
	writeTree(t, root, map[string]string{
		"apps/api/src/.keep":    "",
		"apps/worker/src/.keep": "",
		"apps/tasks/src/.keep":  "",
		"apps/ui/src/.keep":     "",
	})
	code, stdout, stderr := run(t, "generate-modules", "--root", root)
	if code != 0 || stdout != generateModulesStdout {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, stdout, stderr)
	}
	for path, want := range generateModulesGolden {
		got, err := os.ReadFile(filepath.Join(root, path))
		if err != nil || string(got) != want {
			t.Errorf("%s = %q (%v), want %q", path, got, err, want)
		}
	}
}

func TestGenerateModulesDryRunWritesNothing(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, generateModulesFixture)
	code, stdout, _ := run(t, "generate-modules", "--dry-run", "--root", root)
	if code != 0 || !strings.HasPrefix(stdout, "Would generate apps/api/src/process-modules.generated.ts (") {
		t.Fatalf("exit %d, stdout %q", code, stdout)
	}
	if exists(filepath.Join(root, "apps/api/src")) {
		t.Error("dry run wrote a file")
	}
}

func TestSyncReferencesMatchesTheNodeScript(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, syncReferencesFixture)
	code, stdout, stderr := run(t, "sync-references", "--root", root)
	if code != syncReferencesCheckCode || stdout != syncReferencesCheckStdout {
		t.Fatalf("check: exit %d, stdout %q, stderr %q", code, stdout, stderr)
	}
	code, stdout, _ = run(t, "sync-references", "--root", root, "--write")
	if code != 0 || stdout != syncReferencesWriteStdout {
		t.Fatalf("write: exit %d, stdout %q", code, stdout)
	}
	for path, want := range syncReferencesGolden {
		got, err := os.ReadFile(filepath.Join(root, path))
		if err != nil || string(got) != want {
			t.Errorf("%s = %q (%v), want %q", path, got, err, want)
		}
	}
}

func BenchmarkGenerateModules(b *testing.B) {
	root := ensureRepoRoot(b)
	b.ReportAllocs()
	for range b.N {
		if _, err := GenerateModules(root); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSyncReferences(b *testing.B) {
	root := ensureRepoRoot(b)
	members, err := ReadWorkspaceMembers(root)
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	for range b.N {
		for _, project := range DeriveProjects(root, members) {
			text, _ := os.ReadFile(project.File)
			RenderReferences(string(text), project.References)
		}
	}
}

func ensureRepoRoot(b testing.TB) string {
	b.Helper()
	root, err := filepath.Abs("../..")
	if err != nil || !exists(filepath.Join(root, "pnpm-workspace.yaml")) {
		b.Skip("not inside the repository")
	}
	return root
}

package devscripts

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
		"packages/installed-server-modules/src/.keep": "",
		"packages/installed-web-modules/src/.keep":    "",
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
	if code != 0 || !strings.HasPrefix(stdout, "Would generate packages/installed-server-modules/src/server-modules.generated.ts (") {
		t.Fatalf("exit %d, stdout %q", code, stdout)
	}
	if exists(filepath.Join(root, "packages/installed-server-modules/src")) {
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

func ensureBuiltFixture(t testing.TB) string {
	root := t.TempDir()
	tree := map[string]string{}
	for _, dir := range []string{"sdks/typescript", "mcp/typescript", "packages/ksuid", "packages/mail"} {
		tree[dir+"/src/a.ts"] = "x"
		tree[dir+"/node_modules/.keep"] = ""
	}
	writeTree(t, root, tree)
	return root
}

func stampFresh(t testing.TB, root string) {
	t.Helper()
	future := time.Now().Add(time.Hour)
	for _, target := range buildTargets {
		entry := filepath.Join(root, target.dir, target.entry)
		writeTree(t, root, map[string]string{filepath.Join(target.dir, target.entry): ""})
		if err := os.Chtimes(entry, future, future); err != nil {
			t.Fatal(err)
		}
	}
}

func fakePnpm(t testing.TB) string {
	t.Helper()
	bin := t.TempDir()
	log := filepath.Join(bin, "calls")
	script := "#!/bin/sh\necho \"$@\" >> " + log + "\nexit ${FAKE_EXIT:-0}\n"
	if err := os.WriteFile(filepath.Join(bin, "pnpm"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	return log
}

func TestEnsureBuilt(t *testing.T) {
	t.Run("builds nothing when every entry is newer than its sources", func(t *testing.T) {
		root, calls := ensureBuiltFixture(t), fakePnpm(t)
		stampFresh(t, root)
		if code := EnsureBuilt(root, nil, os.Stderr); code != 0 || exists(calls) {
			t.Errorf("code %d, pnpm called: %v", code, exists(calls))
		}
	})
	t.Run("builds a missing entry and its needs, in target order, then stamps and unlocks", func(t *testing.T) {
		root, calls := ensureBuiltFixture(t), fakePnpm(t)
		var stderr bytes.Buffer
		if code := EnsureBuilt(root, []string{"@langwatch/mail"}, &stderr); code != 0 {
			t.Fatalf("code %d: %s", code, stderr.String())
		}
		got, _ := os.ReadFile(calls)
		if want := "--filter @langwatch/ksuid build\n--filter @langwatch/mail build\n"; string(got) != want {
			t.Errorf("pnpm calls = %q, want %q", got, want)
		}
		if !strings.Contains(stderr.String(), "ensure-built: building @langwatch/ksuid (dist/index.d.ts missing or stale)") ||
			!strings.Contains(stderr.String(), "could not stamp dist/index.js: ENOENT: no such file or directory, utime") {
			t.Errorf("stderr = %q", stderr.String())
		}
		if exists(filepath.Join(root, "packages/mail/node_modules/.ensure-built.lock")) {
			t.Error("lock left behind")
		}
	})
	t.Run("asks Nx even when every entry is newer than src, since Nx hashes the inputs outside it", func(t *testing.T) {
		root, calls := ensureBuiltFixture(t), fakePnpm(t)
		writeTree(t, root, map[string]string{"node_modules/.bin/nx": ""})
		stampFresh(t, root)
		if code := EnsureBuilt(root, []string{"@langwatch/mail", "langwatch"}, &bytes.Buffer{}); code != 0 {
			t.Fatalf("code %d", code)
		}
		got, _ := os.ReadFile(calls)
		if want := "exec nx run-many -t build -p langwatch,@langwatch/ksuid,@langwatch/mail --outputStyle=static\n"; string(got) != want {
			t.Errorf("pnpm calls = %q, want %q", got, want)
		}
		if exists(filepath.Join(root, "node_modules/.ensure-built.lock")) {
			t.Error("lock left behind")
		}
	})
	t.Run("fails and unlocks when the Nx build fails", func(t *testing.T) {
		root := ensureBuiltFixture(t)
		fakePnpm(t)
		writeTree(t, root, map[string]string{"node_modules/.bin/nx": ""})
		t.Setenv("FAKE_EXIT", "3")
		if code := EnsureBuilt(root, nil, &bytes.Buffer{}); code != 1 {
			t.Errorf("code %d", code)
		}
		if exists(filepath.Join(root, "node_modules/.ensure-built.lock")) {
			t.Error("lock left behind")
		}
	})
	t.Run("refuses an unknown target by name", func(t *testing.T) {
		var stderr bytes.Buffer
		if code := EnsureBuilt(t.TempDir(), []string{"nope", "@langwatch/mail", "bad"}, &stderr); code != 1 ||
			stderr.String() != "ensure-built: no such target: nope, bad\n" {
			t.Errorf("code %d, stderr %q", code, stderr.String())
		}
	})
	t.Run("fails and unlocks when the build fails", func(t *testing.T) {
		root := ensureBuiltFixture(t)
		fakePnpm(t)
		t.Setenv("FAKE_EXIT", "3")
		if code := EnsureBuilt(root, []string{"@langwatch/mcp-server"}, &bytes.Buffer{}); code != 1 {
			t.Errorf("code %d", code)
		}
		if exists(filepath.Join(root, "mcp/typescript/node_modules/.ensure-built.lock")) {
			t.Error("lock left behind")
		}
	})
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

func BenchmarkEnsureBuilt(b *testing.B) {
	root := ensureBuiltFixture(b)
	stampFresh(b, root)
	b.ReportAllocs()
	for range b.N {
		EnsureBuilt(root, nil, os.Stderr)
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

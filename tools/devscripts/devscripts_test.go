package devscripts

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
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

// ensureBuiltFixture is a workspace whose four dists exist but carry no stamp.
func ensureBuiltFixture(t testing.TB) string {
	root := t.TempDir()
	tree := map[string]string{"feature-map.json": "{}"}
	for _, target := range buildTargets {
		tree[target.dir+"/src/a.ts"] = "x"
		tree[target.dir+"/node_modules/.keep"] = ""
		tree[filepath.Join(target.dir, target.entry)] = ""
	}
	writeTree(t, root, tree)
	return root
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

// builtAgain runs ensure-built after a first full build and returns the
// pnpm calls the second run made.
func builtAgain(t *testing.T, change func(root string)) string {
	t.Helper()
	root, calls := ensureBuiltFixture(t), fakePnpm(t)
	if code := EnsureBuilt(root, nil, &bytes.Buffer{}); code != 0 {
		t.Fatalf("first build: code %d", code)
	}
	_ = os.Remove(calls)
	change(root)
	if code := EnsureBuilt(root, nil, &bytes.Buffer{}); code != 0 {
		t.Fatalf("second build: code %d", code)
	}
	got, _ := os.ReadFile(calls)
	return string(got)
}

// @scenario "A fresh worktree prepares its databases without a manual bundle build"
func TestEnsureBuilt(t *testing.T) {
	t.Run("builds each unstamped dist once, in target order, with a timed line per package", func(t *testing.T) {
		root, calls := ensureBuiltFixture(t), fakePnpm(t)
		var stderr bytes.Buffer
		if code := EnsureBuilt(root, nil, &stderr); code != 0 {
			t.Fatalf("code %d: %s", code, stderr.String())
		}
		got, _ := os.ReadFile(calls)
		want := "--filter langwatch build\n--filter @langwatch/mcp-server build\n" +
			"--filter @langwatch/ksuid build\n--filter @langwatch/mail build\n"
		if string(got) != want {
			t.Errorf("pnpm calls = %q, want %q", got, want)
		}
		if !strings.Contains(stderr.String(), "ensure-built: building @langwatch/ksuid (dist/index.d.ts missing or stale)") ||
			!strings.Contains(stderr.String(), "ensure-built: built @langwatch/mail in ") {
			t.Errorf("stderr = %q", stderr.String())
		}
		if exists(filepath.Join(root, "node_modules/.ensure-built.lock")) {
			t.Error("lock left behind")
		}
	})
	t.Run("builds a requested package and its needs only", func(t *testing.T) {
		root, calls := ensureBuiltFixture(t), fakePnpm(t)
		if code := EnsureBuilt(root, []string{"@langwatch/mail"}, &bytes.Buffer{}); code != 0 {
			t.Fatalf("code %d", code)
		}
		got, _ := os.ReadFile(calls)
		if want := "--filter @langwatch/ksuid build\n--filter @langwatch/mail build\n"; string(got) != want {
			t.Errorf("pnpm calls = %q, want %q", got, want)
		}
	})
	t.Run("builds nothing when no input changed", func(t *testing.T) {
		if got := builtAgain(t, func(string) {}); got != "" {
			t.Errorf("pnpm calls = %q", got)
		}
	})
	t.Run("builds nothing when a source is touched but unchanged", func(t *testing.T) {
		got := builtAgain(t, func(root string) {
			later := time.Now().Add(time.Hour)
			if err := os.Chtimes(filepath.Join(root, "packages/mail/src/a.ts"), later, later); err != nil {
				t.Fatal(err)
			}
		})
		if got != "" {
			t.Errorf("pnpm calls = %q", got)
		}
	})
	t.Run("rebuilds only the package whose source changed", func(t *testing.T) {
		got := builtAgain(t, func(root string) {
			writeTree(t, root, map[string]string{"mcp/typescript/src/a.ts": "y"})
		})
		if got != "--filter @langwatch/mcp-server build\n" {
			t.Errorf("pnpm calls = %q", got)
		}
	})
	t.Run("rebuilds the SDK when an input outside its package changed", func(t *testing.T) {
		got := builtAgain(t, func(root string) {
			writeTree(t, root, map[string]string{"feature-map.json": `{"features":[]}`})
		})
		if got != "--filter langwatch build\n" {
			t.Errorf("pnpm calls = %q", got)
		}
	})
	t.Run("rebuilds a dependant when what it needs changed", func(t *testing.T) {
		got := builtAgain(t, func(root string) {
			writeTree(t, root, map[string]string{"packages/ksuid/src/a.ts": "y"})
		})
		if got != "--filter @langwatch/ksuid build\n--filter @langwatch/mail build\n" {
			t.Errorf("pnpm calls = %q", got)
		}
	})
	t.Run("rebuilds a dist that went missing or that something else rebuilt", func(t *testing.T) {
		got := builtAgain(t, func(root string) {
			_ = os.Remove(filepath.Join(root, "packages/ksuid/dist/index.d.ts"))
			later := time.Now().Add(time.Hour)
			if err := os.Chtimes(filepath.Join(root, "mcp/typescript/dist/index.js"), later, later); err != nil {
				t.Fatal(err)
			}
		})
		if got != "--filter @langwatch/mcp-server build\n--filter @langwatch/ksuid build\n" {
			t.Errorf("pnpm calls = %q", got)
		}
	})
	t.Run("fails, stamps nothing and unlocks when the build fails", func(t *testing.T) {
		root := ensureBuiltFixture(t)
		fakePnpm(t)
		t.Setenv("FAKE_EXIT", "3")
		if code := EnsureBuilt(root, []string{"@langwatch/mcp-server"}, &bytes.Buffer{}); code != 1 {
			t.Errorf("code %d", code)
		}
		if exists(filepath.Join(root, "node_modules/.ensure-built.lock")) {
			t.Error("lock left behind")
		}
		if exists(filepath.Join(root, "mcp/typescript/node_modules", stampName)) {
			t.Error("a failed build was stamped")
		}
	})
	t.Run("refuses an unknown target by name", func(t *testing.T) {
		var stderr bytes.Buffer
		if code := EnsureBuilt(t.TempDir(), []string{"nope", "@langwatch/mail", "bad"}, &stderr); code != 1 ||
			stderr.String() != "ensure-built: no such target: nope, bad\n" {
			t.Errorf("code %d, stderr %q", code, stderr.String())
		}
	})
}

// The SDK's declared inputs must name every workspace path its build reads in nx.json.
func TestEnsureBuiltSDKInputsMatchNx(t *testing.T) {
	root := ensureRepoRoot(t)
	data, err := os.ReadFile(filepath.Join(root, "nx.json"))
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		TargetDefaults struct {
			Build []struct {
				Filter struct{ Projects []string } `json:"filter"`
				Inputs []any                       `json:"inputs"`
			} `json:"build"`
		} `json:"targetDefaults"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	var fromNx []string
	for _, entry := range config.TargetDefaults.Build {
		if !slices.Equal(entry.Filter.Projects, []string{"langwatch"}) {
			continue
		}
		for _, input := range entry.Inputs {
			text, _ := input.(string)
			if path, ok := strings.CutPrefix(text, "{workspaceRoot}/"); ok {
				fromNx = append(fromNx, strings.TrimSuffix(path, "/**/*"))
			}
		}
	}
	if !slices.Equal(fromNx, buildTargets[0].inputs) {
		t.Errorf("nx.json langwatch build inputs = %q, ensure-built has %q", fromNx, buildTargets[0].inputs)
	}
}

func BenchmarkEnsureBuiltFreshCheck(b *testing.B) {
	root := ensureRepoRoot(b)
	b.ReportAllocs()
	for range b.N {
		if _, _, err := staleTargets(root, buildTargets); err != nil {
			b.Fatal(err)
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

func TestLockWorkspaceClearsALockWhoseHolderExited(t *testing.T) {
	lock := filepath.Join(t.TempDir(), ".ensure-built.lock")
	if err := os.Mkdir(lock, 0o755); err != nil {
		t.Fatal(err)
	}
	dead := exec.Command("true")
	if err := dead.Run(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(lock, "pid"), []byte(strconv.Itoa(dead.Process.Pid)), 0o644); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	release := lockWorkspace(lock)
	defer release()
	if waited := time.Since(start); waited > time.Second {
		t.Fatalf("waited %s on a lock whose holder had exited", waited)
	}
	if !holderAlive(lock) {
		t.Fatal("the lock should now name this process as its holder")
	}
}

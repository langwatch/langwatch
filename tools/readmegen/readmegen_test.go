package readmegen

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "rewrite the golden pages in testdata/golden")

// readmeFixture is a small tree: two core modules, one enterprise module, a
// package, two apps, the Prisma schema and one README with a stale block.
var readmeFixture = map[string]string{
	"modules/catalogue.json": `{"version":0,"features":[` +
		`{"id":"alpha","root":"modules/alpha","classification":"core","subjects":["alpha","alpha-item"]},` +
		`{"id":"gamma","root":"modules/gamma","classification":"core","subjects":["gamma"]},` +
		`{"id":"beta","root":"enterprise/modules/beta","classification":"enterprise","subjects":["beta"]}]}`,
	"modules/alpha/contract/package.json":                     `{"name":"@lw/alpha-contract"}`,
	"modules/alpha/process/package.json":                      `{"name":"@lw/alpha-process","dependencies":{"@lw/core":"workspace:*"}}`,
	"modules/alpha/browser/package.json":                      `{"name":"@lw/alpha-browser"}`,
	"modules/alpha/process/node_modules/ignored/package.json": `{"name":"@lw/never-read"}`,
	"modules/alpha/process/dist/package.json":                 `{"name":"@lw/never-read-either"}`,
	"modules/gamma/process/package.json":                      `{"name":"@lw/gamma-process","dependencies":{"@lw/core":"workspace:*"}}`,
	"enterprise/modules/beta/process/package.json":            `{"name":"@lw/enterprise-beta-process"}`,
	"enterprise/packages/signing/package.json":                `{"name":"@lw/signing","description":"Signs licenses | offline."}`,
	"packages/core/package.json":                              `{"name":"@lw/core","description":"The core vocabulary."}`,
	"packages/core/README.md":                                 "# @lw/core\n\nThe core vocabulary.\n",
	"apps/api/package.json":                                   `{"name":"@lw/api","description":"The api process."}`,
	"apps/ui/package.json":                                    `{"name":"@lw/ui","description":"The browser process."}`,
	"apps/api/src/process-modules.generated.ts": "import { alphaProcessModule } from \"@lw/alpha-process\";\n" +
		"import { gammaProcessModule } from \"@lw/gamma-process\";\n",
	"apps/ui/src/browser-modules.generated.ts": "import { alphaWeb } from \"@lw/alpha-browser/declaration\";\n",
	"packages/prisma-client/prisma/schema.prisma": "model AlphaItem {\n  id String @id\n  @@map(\"alpha_item\")\n}\n\n" +
		"model GammaThing {\n  id String @id\n}\n",
	"modules/alpha/README.md": "# alpha\n\nAlpha keeps the items every gamma reads.\n\n" +
		"<!-- readme:generated:start (stale) -->\n\nstale body\n\n<!-- readme:generated:end -->\n\nA footnote the generator keeps.\n",
}

func writeFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for name, content := range readmeFixture {
		file := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(content), 0o600); err != nil { // #nosec G703 -- under the test's own root
			t.Fatal(err)
		}
	}
	return root
}

func runReadmegen(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	manifest, err := filepath.Abs(filepath.Join("testdata", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	code := Run(append(args, "--manifest", manifest), &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

// generatedPages lists every README the run wrote, relative to the root.
func generatedPages(t *testing.T, root string) []string {
	t.Helper()
	var pages []string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || entry.Name() != "README.md" {
			return err
		}
		relative, err := filepath.Rel(root, path)
		pages = append(pages, filepath.ToSlash(relative))
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(pages)
	return pages
}

func TestWriteMatchesGoldenPages(t *testing.T) {
	root := writeFixture(t)
	code, stdout, stderr := runReadmegen(t, "--write", "--root", root)
	if code != 0 {
		t.Fatalf("--write exited %d: %s", code, stderr)
	}
	if !strings.Contains(stdout, "Wrote modules/alpha/README.md\n") {
		t.Errorf("stdout does not report the alpha page:\n%s", stdout)
	}
	if !strings.Contains(stderr, "unresolved values (shown with ≈): 1 config, 1 peer") {
		t.Errorf("stderr does not count the unresolved values:\n%s", stderr)
	}
	for _, page := range generatedPages(t, root) {
		if page == "packages/core/README.md" {
			continue
		}
		got, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(page)))
		if err != nil {
			t.Fatal(err)
		}
		golden := filepath.Join("testdata", "golden", strings.ReplaceAll(page, "/", "__")+".golden")
		if *update {
			if err := os.WriteFile(golden, got, 0o600); err != nil { // #nosec G703 -- a golden file under testdata
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(golden) // #nosec G304 -- a golden file under testdata
		if err != nil {
			t.Fatalf("no golden for %s (run go test -update): %v", page, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s differs from its golden:\n%s", page, unifiedDiff(page, string(want), string(got)))
		}
	}
}

func TestCheckNamesUndescribedPagesThenPassesOnceDescribed(t *testing.T) {
	root := writeFixture(t)
	if code, _, stderr := runReadmegen(t, "--write", "--root", root); code != 0 {
		t.Fatalf("--write exited %d: %s", code, stderr)
	}
	code, _, stderr := runReadmegen(t, "--check", "--root", root)
	if code != 1 || !strings.Contains(stderr, "modules/gamma/README.md: describe gamma in a paragraph above the generated block") {
		t.Fatalf("--check exited %d without naming the undescribed gamma page:\n%s", code, stderr)
	}
	if strings.Contains(stderr, "modules/alpha/README.md: describe") {
		t.Errorf("--check refused alpha, which keeps its description:\n%s", stderr)
	}
	for _, page := range generatedPages(t, root) {
		file := filepath.Join(root, filepath.FromSlash(page))
		content, err := os.ReadFile(file) // #nosec G304 -- a page under the test's own root
		if err != nil {
			t.Fatal(err)
		}
		described := strings.Replace(string(content), "\n\n<!-- readme:generated:start", "\n\nWhat this is for.\n\n<!-- readme:generated:start", 1)
		if err := os.WriteFile(file, []byte(described), 0o600); err != nil { // #nosec G703 -- under the test's own root
			t.Fatal(err)
		}
	}
	if code, stdout, stderr := runReadmegen(t, "--check", "--root", root); code != 0 || stdout != "" {
		t.Fatalf("--check exited %d on described, fresh pages:\n%s%s", code, stdout, stderr)
	}
}

func TestCheckPrintsADiffForAStalePage(t *testing.T) {
	root := writeFixture(t)
	if code, _, stderr := runReadmegen(t, "--write", "--root", root); code != 0 {
		t.Fatalf("--write exited %d: %s", code, stderr)
	}
	file := filepath.Join(root, "modules", "alpha", "README.md")
	content, err := os.ReadFile(file) // #nosec G304 -- a page under the test's own root
	if err != nil {
		t.Fatal(err)
	}
	stale := strings.Replace(string(content), "[gamma](../gamma/README.md) (as a peer)", "nobody", 1)
	if err := os.WriteFile(file, []byte(strings.Replace(stale, "`gammas`", "`old`", 1)), 0o600); err != nil { // #nosec G703 -- under the test's own root
		t.Fatal(err)
	}
	code, stdout, _ := runReadmegen(t, "--check", "--root", root, "--only", "modules/alpha/")
	if code != 1 {
		t.Fatalf("--check exited %d on a stale page", code)
	}
	for _, want := range []string{"--- a/modules/alpha/README.md", "-| `old`", "+| `gammas`"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("the diff lacks %q:\n%s", want, stdout)
		}
	}
	if strings.Contains(stdout, "modules/gamma") {
		t.Errorf("--only modules/alpha/ diffed another page:\n%s", stdout)
	}
}

func TestRunRefusesWithoutExactlyOneMode(t *testing.T) {
	for _, args := range [][]string{{}, {"--write", "--check"}} {
		if code, _, _ := runReadmegen(t, args...); code != 2 {
			t.Errorf("Run(%v) exited %d, want 2", args, code)
		}
	}
}

func TestDescribedIgnoresTitlesCommentsAndBlankLines(t *testing.T) {
	cases := map[string]bool{
		"# x\n\n<!-- a note -->\n\n" + startMarker:           false,
		"# x\n\n<!--\nmany\nlines\n-->\n" + startMarker:      false,
		"# x\n\nA paragraph.\n\n" + startMarker:              true,
		"# x\n\n## Heading only\n\n" + startMarker + "\nyes": false,
	}
	for content, want := range cases {
		if got := described(content); got != want {
			t.Errorf("described(%q) = %v, want %v", content, got, want)
		}
	}
}

func TestTablePadsColumnsAndEscapesPipes(t *testing.T) {
	got := table([]string{"A", "Name"}, [][]string{{"≈x", cell("a|b")}})
	want := "| A   | Name |\n| --- | ---- |\n| ≈x  | a\\|b |\n"
	if got != want {
		t.Errorf("table() =\n%s\nwant\n%s", got, want)
	}
}

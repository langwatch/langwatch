package importext

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func runOnFixture(t *testing.T, root string, dryRun bool) *Report {
	t.Helper()
	report, err := Execute(Options{Roots: []string{"."}, Root: root, DryRun: dryRun, OnlyClean: false})
	if err != nil {
		t.Fatal(err)
	}
	return report
}

func TestExecuteRewritesEverySyntacticForm(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "target.ts", "export const value = 1;\n")
	writeFixture(t, root, "widget.tsx", "export const Widget = null;\n")
	source := strings.Join([]string{
		`import { value } from "./target";`,
		`import './target';`,
		`export { value } from './target';`,
		`const lazy = await import("./target");`,
		`vi.mock("./target");`,
		`vi.doMock('./target');`,
		`const actual = await vi.importActual("./target");`,
		`const path = require.resolve("./widget");`,
		`import pkg from "@langwatch/api";`,
		`import node from "node:path";`,
		"",
	}, "\n")
	writeFixture(t, root, "entry.ts", source)

	report := runOnFixture(t, root, false)
	if report.SpecifiersRewritten != 8 {
		t.Fatalf("rewrote %d specifiers, want 8", report.SpecifiersRewritten)
	}
	written, err := os.ReadFile(filepath.Join(root, "entry.ts"))
	if err != nil {
		t.Fatal(err)
	}
	got := string(written)
	if strings.Count(got, `"./target.ts"`) != 4 || strings.Count(got, `'./target.ts'`) != 3 {
		t.Errorf("quote style not preserved:\n%s", got)
	}
	if !strings.Contains(got, `require.resolve("./widget.tsx")`) {
		t.Errorf("require.resolve not rewritten:\n%s", got)
	}
	for _, untouched := range []string{`"@langwatch/api"`, `"node:path"`} {
		if !strings.Contains(got, untouched) {
			t.Errorf("expected %s to be left alone:\n%s", untouched, got)
		}
	}
}

func TestExecutePreservesEveryOtherByte(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "target.ts", "")
	source := "// a comment with \"./target\" inside it is left as prose\r\n" +
		"import   {  value  }   from    './target'  ;  // trailing\r\n" +
		"\t\tconst indented = 1;\n\n\n"
	writeFixture(t, root, "entry.ts", source)

	runOnFixture(t, root, false)
	written, err := os.ReadFile(filepath.Join(root, "entry.ts"))
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(source, "'./target'", "'./target.ts'", 1)
	if string(written) != want {
		t.Errorf("bytes changed beyond the specifier:\ngot  %q\nwant %q", string(written), want)
	}
}

func TestExecuteDryRunWritesNothing(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "target.ts", "")
	source := `import { value } from "./target";` + "\n"
	writeFixture(t, root, "entry.ts", source)

	report := runOnFixture(t, root, true)
	if report.FilesRewritten != 1 || report.SpecifiersRewritten != 1 {
		t.Fatalf("plan = %d files / %d specifiers, want 1 / 1", report.FilesRewritten, report.SpecifiersRewritten)
	}
	written, err := os.ReadFile(filepath.Join(root, "entry.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if string(written) != source {
		t.Errorf("dry run wrote %q", string(written))
	}
}

func TestExecuteReportsWhatItRefusesToRewrite(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "data.json", "{}")
	writeFixture(t, root, "attributed.json", "{}")
	source := strings.Join([]string{
		`import data from "./data.json";`,
		`import attributed from "./attributed.json" with { type: "json" };`,
		`import aliased from "~/model/thing";`,
		`import gone from "./nowhere";`,
		`import styles from "./styles.css";`,
		"",
	}, "\n")
	writeFixture(t, root, "entry.ts", source)

	report := runOnFixture(t, root, false)
	if len(report.JSONImports) != 1 || report.JSONImports[0].Specifier != "./data.json" {
		t.Errorf("json imports = %+v", report.JSONImports)
	}
	if len(report.AliasImports) != 1 || report.AliasImports[0].Specifier != "~/model/thing" {
		t.Errorf("alias imports = %+v", report.AliasImports)
	}
	if len(report.Unresolved) != 1 || report.Unresolved[0].Specifier != "./nowhere" {
		t.Errorf("unresolved = %+v", report.Unresolved)
	}
	if report.FilesRewritten != 0 {
		t.Errorf("rewrote %d files, want 0", report.FilesRewritten)
	}
}

func TestExecuteSkipsGeneratedDirectories(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "node_modules/pkg/target.ts", "")
	writeFixture(t, root, "node_modules/pkg/entry.ts", `import x from "./target";`+"\n")
	report := runOnFixture(t, root, false)
	if report.FilesScanned != 0 {
		t.Errorf("scanned %d files inside node_modules, want 0", report.FilesScanned)
	}
}

func TestExecuteRecordsLineNumbers(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "target.ts", "")
	writeFixture(t, root, "entry.ts", "\n\nimport x from \"./target\";\n")
	report := runOnFixture(t, root, true)
	if len(report.Rewritten) != 1 || report.Rewritten[0].Changes[0].Line != 3 {
		t.Fatalf("report = %+v", report.Rewritten)
	}
}

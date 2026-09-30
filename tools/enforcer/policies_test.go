package enforcer

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/internal/workspace"
)

// seededTree carries one violation per ported policy. SEED_OUT writes it out
// so the TS CLI can be run over the same tree (.claude/tmp differential).
var seededTree = map[string]string{
	"pnpm-workspace.yaml": "packages:\n  - modules/*/*\n",
	"modules/catalogue.json": `{"version": 0, "features": [
		{"id": "alpha", "root": "modules/alpha", "classification": "core", "subjects": ["alpha"]}]}`,
	"modules/alpha/contract/package.json": `{"name": "@langwatch/alpha-contract", "exports": {".": "./src/index.ts"},
		"scripts": {"build": "tsc"}, "dependencies": {"@langwatch/alpha-process": "workspace:*"}}`,
	"modules/alpha/contract/src/index.ts": "export const contract = 1;\n",
	"modules/alpha/process/package.json": `{"name": "@langwatch/alpha-process", "exports": {".": "./src/index.ts"},
		"dependencies": {"@langwatch/alpha-contract": "workspace:*"}}`,
	"modules/alpha/process/src/index.ts": "export { used } from \"./used.ts\";\n",
	"modules/alpha/process/src/used.ts": "export const used = 1;\nexport function unused() {}\nexport type { Hidden as Shown };\n" +
		"export default class Named {}\nconst text = \"import { unused } from './used.ts'\";\n",
	"modules/alpha/process/src/lazy.ts":             "export const lazy = 1;\n",
	"modules/alpha/process/src/lazy.config.ts":      "export default {};\n",
	"modules/alpha/process/src/__tests__/a.test.ts": "export const inTest = 1;\n",
	"apps/api/src/main.ts": "import Named from \"../../../modules/alpha/process/src/used.ts\";\n" +
		"const lazy = () => import(\"../../../modules/alpha/process/src/lazy.ts\");\n",
	"modules/alpha/browser/package.json": `{"name": "@langwatch/alpha-browser", "exports": {".": "./src/index.ts"}}`,
	"modules/alpha/browser/src/index.ts": "import type { A } from \"node:path\";\nimport { leak } from \"./leak.ts\";\n",
	"modules/alpha/browser/src/leak.ts":  "// a comment\nimport { readFileSync } from \"node:fs\";\nexport const leak = readFileSync;\n",
	"dev/tsconfig.declarations.json":     `{"references": [{"path": "../modules/alpha/contract/tsconfig.build.json"}]}`,
}

func writeTree(tb testing.TB, root string, tree map[string]string) {
	tb.Helper()
	for path, content := range tree {
		full := filepath.Join(root, path)
		if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil { //nolint:gosec // G703: fixture paths are literals under a temp dir or the SEED_OUT the operator names
			tb.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o600); err != nil { //nolint:gosec // G703: as above
			tb.Fatal(err)
		}
	}
}

func seeded(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if out := os.Getenv("SEED_OUT"); out != "" {
		root = out
	}
	writeTree(t, root, seededTree)
	return root
}

func lines(findings []Violation) []string {
	var out []string
	for _, f := range findings {
		out = append(out, fmt.Sprintf("%s %s:%d %s", f.Policy, f.File, f.Line, f.Specifier))
	}
	return out
}

func TestPortedPoliciesOnTheSeededTree(t *testing.T) {
	root := seeded(t)
	cases := map[string][]string{
		"unused-module-export": {
			"unused-module-export modules/alpha/process/src/used.ts:0 ",
			"unused-module-export modules/alpha/process/src/used.ts:0 ",
			"unused-module-export modules/alpha/process/src/used.ts:0 ",
		},
		"cycles":                         {"package-cycle modules/alpha/contract/package.json:0 "},
		"contract-build-config":          {"contract-build-config modules/alpha/contract/tsconfig.build.json:0 "},
		"browser-node-leak":              {"browser-node-leak modules/alpha/browser/src/leak.ts:2 node:fs"},
		"declaration-project-references": {"declaration-project-references dev/tsconfig.declarations.json:0 "},
	}
	for id, want := range cases {
		t.Run(id, func(t *testing.T) {
			findings, err := Lint(root, []string{id}, false)
			if err != nil {
				t.Fatal(err)
			}
			if got := lines(findings); !slices.Equal(got, want) {
				t.Fatalf("got\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
			}
		})
	}
	findings, _ := Lint(root, []string{"unused-module-export"}, false)
	var names []string
	for _, f := range findings {
		names = append(names, strings.SplitN(f.Message, "`", 5)[3])
	}
	if want := []string{"Named", "Shown", "unused"}; !slices.Equal(names, want) {
		t.Fatalf("unused names %v, want %v (a default import reads default, not the class name, as in TS)", names, want)
	}
}

func TestDeclarationReferencesRefuseWithoutTheirAnchor(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{"modules/catalogue.json": `{"version": 0, "features": []}`, "pnpm-workspace.yaml": "packages:\n"})
	_, err := Lint(root, []string{"declaration-project-references"}, false)
	var missing *workspace.MissingAnchorError
	if !errors.As(err, &missing) || missing.Anchor != "dev/tsconfig.declarations.json" {
		t.Fatalf("err = %v, want a MissingAnchorError for dev/tsconfig.declarations.json", err)
	}
}

func TestDiscoveryReportsAnUnregisteredFeatureRoot(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{
		"modules/catalogue.json":             `{"version": 0, "features": []}`,
		"modules/stray/process/package.json": `{"name": "@langwatch/wrong"}`,
	})
	findings, err := Lint(root, []string{"cycles"}, false)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"feature-catalogue modules/stray:0 ", "feature-layout modules/stray/process/package.json:0 "}
	if got := lines(findings); !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

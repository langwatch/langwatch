package lintrun_test

import (
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/lintrun"
)

func existing(files ...string) func(string) bool {
	return func(f string) bool { return slices.Contains(files, f) }
}

// @scenario "A plain lint:changed lints the changed files, not their dependants"
func TestPlainScopeLintsOnlyTheChangedLintableFiles(t *testing.T) {
	files := []string{"tools/lintrun/run.go", "dev/nx/lint-plugin.mjs", "packages/time/README.md", "packages/time/src/gone.ts"}
	got := lintrun.PlainScope(files, []string{"modules/catalogue.json"}, existing("dev/nx/lint-plugin.mjs", "packages/time/README.md"))
	if want := []string{"dev/nx/lint-plugin.mjs"}; !reflect.DeepEqual(got, want) {
		t.Errorf("PlainScope = %q, want %q", got, want)
	}
}

// @scenario "A changed lint global relints the whole tree"
func TestPlainScopeLintsTheTreeWhenALintGlobalChanged(t *testing.T) {
	files := []string{"dev/nx/lint-plugin.mjs", ".oxlintrc.native.jsonc"}
	got := lintrun.PlainScope(files, []string{".oxlintrc.*.jsonc"}, existing(files...))
	if want := []string{"."}; !reflect.DeepEqual(got, want) {
		t.Errorf("PlainScope = %q, want %q", got, want)
	}
}

func TestLintGlobalsUseOnlySyntaxMatchGlobSupports(t *testing.T) {
	nx, err := os.ReadFile(filepath.Join("..", "..", "nx.json"))
	if err != nil {
		t.Fatal(err)
	}
	globals, err := lintrun.LintGlobals(nx)
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range globals {
		if strings.ContainsAny(g, "{}()!+@") || strings.Contains(g, "?(") {
			t.Errorf("lint global %q uses braces or extglob, which MatchGlob does not support", g)
		}
	}
}

// @scenario "A changed lint global relints the whole tree"
func TestLintGlobalsExpandNxJSONsNamedInputs(t *testing.T) {
	nx, err := os.ReadFile(filepath.Join("..", "..", "nx.json"))
	if err != nil {
		t.Fatal(err)
	}
	globals, err := lintrun.LintGlobals(nx)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"tsconfig.base.json", ".oxlintrc.jsonc", ".oxlintrc.plugin.jsonc", "packages/oxlint-rules/src/rules/a/b.mjs", "modules/catalogue.json", "modules/trace/process/package.json"} {
		if !slices.ContainsFunc(globals, func(g string) bool { return lintrun.MatchGlob(g, file) }) {
			t.Errorf("%s is a lint global, but no glob in %q matches it", file, globals)
		}
	}
	if slices.ContainsFunc(globals, func(g string) bool { return lintrun.MatchGlob(g, "modules/trace/process/src/a.ts") }) {
		t.Errorf("a module source file matched a lint global in %q", globals)
	}
}

func TestMatchGlob(t *testing.T) {
	cases := []struct {
		glob, name string
		want       bool
	}{
		{"packages/oxlint-rules/**/*", "packages/oxlint-rules/a.mjs", true},
		{"packages/oxlint-rules/**/*", "packages/oxlint-rules/src/x/a.mjs", true},
		{"packages/oxlint-rules/**/*", "packages/oxlint-rules", false},
		{"packages/architecture-enforcer/oxlint*", "packages/architecture-enforcer/oxlint.config.mjs", true},
		{"modules/*/*/package.json", "modules/trace/package.json", false},
		{".oxlintrc.*.jsonc", ".oxlintrc.jsonc", false},
	}
	for _, c := range cases {
		if got := lintrun.MatchGlob(c.glob, c.name); got != c.want {
			t.Errorf("MatchGlob(%q, %q) = %v, want %v", c.glob, c.name, got, c.want)
		}
	}
}

func TestMemberRootsReadsThePnpmWorkspace(t *testing.T) {
	root := t.TempDir()
	for _, dir := range []string{"apps/api", "apps/ui", "modules/trace/process", "apps/notes"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o750); err != nil {
			t.Fatal(err)
		}
		if dir != "apps/notes" {
			if err := os.WriteFile(filepath.Join(root, dir, "package.json"), []byte("{}"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	workspace := []byte("packages:\n  - modules/*/*\n  - apps/*\n\ncatalog:\n  - not/a/member\n")
	patterns := lintrun.MemberPatterns(workspace)
	if want := []string{"modules/*/*", "apps/*"}; !reflect.DeepEqual(patterns, want) {
		t.Fatalf("MemberPatterns = %q, want %q", patterns, want)
	}
	roots, err := lintrun.MemberRoots(root, patterns)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"apps/api", "apps/ui", "modules/trace/process"}; !reflect.DeepEqual(roots, want) {
		t.Errorf("MemberRoots = %q, want %q", roots, want)
	}
}

func TestAffectedRootsKeepsTheMembersNxListed(t *testing.T) {
	names := map[string]string{"apps/api": "@langwatch/api", "packages/time": "@langwatch/time"}
	got, err := lintrun.AffectedRoots([]string{"apps/api", "packages/time"}, []string{"@langwatch/time"},
		func(m string) (string, error) { return names[m], nil })
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"packages/time"}; !reflect.DeepEqual(got, want) {
		t.Errorf("AffectedRoots = %q, want %q", got, want)
	}
}

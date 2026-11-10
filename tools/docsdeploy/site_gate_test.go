package docsdeploy_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

const repoRoot = "../.."

// testOnlyPackages never reach the site; build-inputs.ts skips the same ones.
var testOnlyPackages = map[string]bool{"@langwatch/vitest-config": true}

type manifest struct {
	Name             string            `json:"name"`
	Dependencies     map[string]string `json:"dependencies"`
	PeerDependencies map[string]string `json:"peerDependencies"`
	DevDependencies  map[string]string `json:"devDependencies"`
}

func readManifest(t *testing.T, dir string) manifest {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRoot, dir, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("%s/package.json: %v", dir, err)
	}

	return m
}

// workspaceGlobs are the package globs pnpm-workspace.yaml lists under `packages:`.
func workspaceGlobs(t *testing.T) []string {
	t.Helper()
	_, block, found := strings.Cut("\n"+readRepoFile(t, "pnpm-workspace.yaml"), "\npackages:\n")
	if !found {
		t.Fatal("pnpm-workspace.yaml lists no packages")
	}
	var globs []string
	for line := range strings.SplitSeq(block, "\n") {
		glob, ok := strings.CutPrefix(line, "  - ")
		if !ok {
			break
		}
		globs = append(globs, strings.Trim(glob, "'\""))
	}

	return globs
}

// workspaceDirs maps each workspace package name to its directory, through pnpm-workspace.yaml.
func workspaceDirs(t *testing.T) map[string]string {
	t.Helper()
	dirs := map[string]string{}
	for _, glob := range workspaceGlobs(t) {
		if strings.HasPrefix(glob, "!") {
			continue
		}
		matches, err := filepath.Glob(filepath.Join(repoRoot, glob, "package.json"))
		if err != nil {
			t.Fatalf("workspace glob %q: %v", glob, err)
		}
		for _, match := range matches {
			dir, err := filepath.Rel(repoRoot, filepath.Dir(match))
			if err != nil {
				t.Fatal(err)
			}
			dirs[readManifest(t, filepath.ToSlash(dir)).Name] = filepath.ToSlash(dir)
		}
	}
	if len(dirs) == 0 {
		t.Fatal("pnpm-workspace.yaml's globs match no package")
	}

	return dirs
}

// siteDependencies is the docs build's workspace closure, as apps/docs/src/site/build-inputs.ts
// walks it: runtime and peer dependencies transitively, and the app's own dev dependencies.
func siteDependencies(t *testing.T) []string {
	t.Helper()
	dirs := workspaceDirs(t)
	found := map[string]bool{"apps/docs": true}
	pending := []string{"apps/docs"}
	for len(pending) > 0 {
		dir := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		m := readManifest(t, dir)
		specs := []map[string]string{m.Dependencies, m.PeerDependencies}
		if dir == "apps/docs" {
			specs = append(specs, m.DevDependencies)
		}
		for _, deps := range specs {
			for name, spec := range deps {
				if !strings.HasPrefix(spec, "workspace:") || testOnlyPackages[name] {
					continue
				}
				target, ok := dirs[name]
				if !ok {
					t.Errorf("%s depends on %s, which no pnpm-workspace.yaml glob reaches", dir, name)

					continue
				}
				if found[target] {
					continue
				}
				found[target] = true
				pending = append(pending, target)
			}
		}
	}
	out := make([]string, 0, len(found))
	for dir := range found {
		out = append(out, dir)
	}
	sort.Strings(out)

	return out
}

func readRepoFile(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRoot, path))
	if err != nil {
		t.Fatal(err)
	}

	return string(raw)
}

// siteFilter is the docs-site filter's patterns in docs-site.yml's change detector.
func siteFilter(t *testing.T) []string {
	t.Helper()
	wf := readRepoFile(t, ".github/workflows/docs-site.yml")
	_, block, found := strings.Cut(wf, "\n            docs-site:\n")
	if !found {
		t.Fatal("docs-site.yml declares no docs-site filter")
	}
	var patterns []string
	for line := range strings.SplitSeq(block, "\n") {
		item, ok := strings.CutPrefix(line, "              - ")
		if !ok {
			break
		}
		patterns = append(patterns, strings.Trim(item, "'\""))
	}

	return patterns
}

// @scenario "The docs site builds, audits and deploys only when what it shows changed"
func TestSiteFilterCoversEveryPackageTheBuildReads(t *testing.T) {
	patterns := siteFilter(t)
	listed := map[string]bool{}
	for _, p := range patterns {
		listed[p] = true
	}
	for _, dir := range siteDependencies(t) {
		if !listed[dir+"/**"] {
			t.Errorf("the docs build reads %s, but the docs-site filter does not list %s/**", dir, dir)
		}
	}
	for _, want := range []string{"docs/**", ".github/workflows/docs-site.yml", "tools/docsdeploy/**"} {
		if !listed[want] {
			t.Errorf("the docs-site filter does not list %s", want)
		}
	}
	reads := map[string]bool{}
	for _, dir := range siteDependencies(t) {
		reads[dir] = true
	}
	packages := map[string]bool{}
	for _, dir := range workspaceDirs(t) {
		packages[dir] = true
	}
	for _, p := range patterns {
		dir := strings.TrimSuffix(p, "/**")
		if packages[dir] && !reads[dir] {
			t.Errorf("the docs-site filter lists %s, a workspace package the site build never reads", p)
		}
	}
}

// @scenario "The docs site builds, audits and deploys only when what it shows changed"
func TestSiteGateIsWiredFromTheDetectorToTheHeavyJobs(t *testing.T) {
	detector := readRepoFile(t, ".github/actions/detect-changes/action.yml")
	for _, want := range []string{
		"\n  docs-site:\n",
		"steps.filter.outputs.docs-site || steps.sha.outputs.docs-site || steps.force.outputs.docs-site",
		`echo "docs-site=true" >> "$GITHUB_OUTPUT"`,
	} {
		if !strings.Contains(detector, want) {
			t.Errorf("the change detector lacks %q", want)
		}
	}
	wf := readRepoFile(t, ".github/workflows/docs-site.yml")
	for _, want := range []string{
		"docs-site: ${{ steps.detect.outputs.docs-site }}",
		"push-strategy: diff",
		"  build:\n    needs: changes\n    if: needs.changes.outputs.docs-site == 'true'",
	} {
		if !strings.Contains(wf, want) {
			t.Errorf("docs-site.yml lacks %q", want)
		}
	}
	if !strings.Contains(deployJob(t), "needs.changes.outputs.docs-site == 'true'") {
		t.Error("the deploy job does not wait for a change to what the site shows")
	}
}

package docscheck

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"testing"
)

func TestCollectNavPages(t *testing.T) {
	tests := []struct {
		name string
		nav  string
		want []string
	}{
		{
			name: "collects pages from groups nested under anchors",
			nav: `{"anchors":[{"anchor":"A","groups":[
				{"group":"G","pages":["one","two"]}]}]}`,
			want: []string{"one", "two"},
		},
		{
			name: "collects pages from a group nested inside another group's pages",
			nav: `{"anchors":[{"anchor":"A","groups":[
				{"group":"G","pages":["one",{"group":"Inner","pages":["deep"]}]}]}]}`,
			want: []string{"deep", "one"},
		},
		{
			name: "does not collect structural strings",
			// Only strings under a "pages" key are page references. An anchor
			// name, an icon or a group title must not be mistaken for one.
			nav: `{"anchors":[{"anchor":"Platform","icon":"code","groups":[
				{"group":"Get Started","pages":["intro"]}]}]}`,
			want: []string{"intro"},
		},
		{
			name: "does not collect an external href as a page",
			nav: `{"anchors":[{"anchor":"A","href":"https://example.com","groups":[
				{"group":"G","pages":["real"]}]}]}`,
			want: []string{"real"},
		},
		{
			name: "collects link-only global divisions without inventing pages",
			nav: `{"global":{"anchors":[{"anchor":"Blog","href":"https://x/y"}]},
				"anchors":[{"anchor":"A","groups":[{"group":"G","pages":["p"]}]}]}`,
			want: []string{"p"},
		},
		{
			name: "keeps duplicates, because the duplicate rule needs to see them",
			nav: `{"anchors":[{"anchor":"A","groups":[
				{"group":"G1","pages":["same"]},{"group":"G2","pages":["same"]}]}]}`,
			want: []string{"same", "same"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := collectNavPages(json.RawMessage(test.nav))
			if err != nil {
				t.Fatalf("collectNavPages() errored: %v", err)
			}
			// Map iteration randomizes sibling order, so compare as a multiset.
			sort.Strings(got)
			want := slices.Clone(test.want)
			sort.Strings(want)
			if !slices.Equal(got, want) {
				t.Errorf("collectNavPages() = %v, want %v", got, want)
			}
		})
	}
}

// A missing navigation used to yield zero pages, which made the orphan rule
// report every page on the site — hundreds of findings for one absent key.
func TestCollectNavPagesRefusesAnAbsentNavigation(t *testing.T) {
	if _, err := collectNavPages(nil); err == nil {
		t.Error("collectNavPages(nil) returned no error; a missing navigation has to fail loudly")
	}
}

func TestLoadRefusesADocsJsonWithNoNavigation(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, map[string]string{
		"charts/langwatch/Chart.yaml": "appVersion: 3.12.0\n",
		"docs/a.mdx":                  "---\ntitle: t\n---\nbody\n",
		"docs/docs.json":              `{"theme":"mint","name":"N"}`,
	})

	_, err := Load(root, "docs", "charts/langwatch/Chart.yaml")
	if err == nil {
		t.Fatal("Load() succeeded; it has to refuse rather than report every page as an orphan")
	}
}

func TestLoadReadsPagesRedirectsAndChartVersion(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, map[string]string{
		"charts/langwatch/Chart.yaml": "name: langwatch\nversion: 1.0.0\nappVersion: 3.12.0\n",
		"docs/a.mdx":                  "---\ntitle: t\n---\nlangwatch/langwatch:3.0.0\n",
		"docs/sub/b.md":               "---\ntitle: t\n---\nbody\n",
		// Not servable: a snippet is included by other pages, and a README is
		// repository documentation.
		"docs/snippets/s.mdx": "shared\n",
		"docs/README.md":      "# readme\n",
		"docs/docs.json": `{"navigation":{"anchors":[{"anchor":"A","groups":[
			{"group":"G","pages":["a","sub/b"]}]}]},
			"redirects":[{"source":"/old","destination":"/a"}]}`,
	})

	in, err := Load(root, "docs", "charts/langwatch/Chart.yaml")
	if err != nil {
		t.Fatalf("Load() errored: %v", err)
	}

	if in.ChartVersion != "3.12.0" {
		t.Errorf("ChartVersion = %q, want 3.12.0", in.ChartVersion)
	}
	pages := slices.Clone(in.ContentPages)
	sort.Strings(pages)
	if !slices.Equal(pages, []string{"a", "sub/b"}) {
		t.Errorf("ContentPages = %v, want [a sub/b] — snippets and README are not pages", pages)
	}
	if len(in.Redirects) != 1 || in.Redirects[0].Destination != "/a" {
		t.Errorf("Redirects = %v, want one entry pointing at /a", in.Redirects)
	}
	if len(in.VersionRefs) != 1 || in.VersionRefs[0].Version != "3.0.0" {
		t.Fatalf("VersionRefs = %v, want the 3.0.0 image tag in a.mdx", in.VersionRefs)
	}
	// The path is reported relative to the repository, so a reader can open it.
	if in.VersionRefs[0].File != "docs/a.mdx" {
		t.Errorf("VersionRef.File = %q, want docs/a.mdx", in.VersionRefs[0].File)
	}
}

func TestLoadRequiresAnAppVersion(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, map[string]string{
		// `version` is not `appVersion`; the rule compares against the release
		// the chart ships, so matching the wrong field would judge every page
		// against a number nobody deploys.
		"charts/langwatch/Chart.yaml": "name: langwatch\nversion: 9.9.9\n",
		"docs/a.mdx":                  "---\ntitle: t\n---\nbody\n",
		"docs/docs.json": `{"navigation":{"anchors":[{"anchor":"A","groups":[
			{"group":"G","pages":["a"]}]}]}}`,
	})

	if _, err := Load(root, "docs", "charts/langwatch/Chart.yaml"); err == nil {
		t.Error("Load() succeeded with no appVersion; it has to say so")
	}
}

func writeFixture(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for rel, contents := range files {
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

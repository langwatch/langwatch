package docsscan_test

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/pkg/docsscan"
)

// only asserts that Check fired exactly the rules named, and returns the
// findings for a case that wants to look closer. Comparing whole findings would
// couple every test to the remedy prose, and that prose is copy.
func only(t *testing.T, in docsscan.Inputs, want ...docsscan.Kind) []docsscan.Finding {
	t.Helper()
	findings := docsscan.Check(in)
	got := make([]docsscan.Kind, 0, len(findings))
	for _, finding := range findings {
		got = append(got, finding.Kind)
	}
	if len(got) != len(want) {
		t.Fatalf("Check() fired %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("Check() fired %v, want %v", got, want)
		}
	}
	return findings
}

// @scenario "A page missing from the navigation is reported"
func TestOrphanPageIsReported(t *testing.T) {
	findings := only(t, docsscan.Inputs{
		NavPages:     []string{"introduction"},
		ContentPages: []string{"introduction", "research/internal-note"},
	}, docsscan.OrphanPage)

	if findings[0].Where != "research/internal-note" {
		t.Errorf("reported %q, want the unreferenced page", findings[0].Where)
	}
	if !strings.Contains(findings[0].Fix, "dev/docs/") {
		t.Errorf("remedy %q does not offer moving an internal note out of the site", findings[0].Fix)
	}
}

// @scenario "A navigation entry with no page behind it is reported"
func TestNavEntryWithoutFileIsReported(t *testing.T) {
	only(t, docsscan.Inputs{
		NavPages:     []string{"introduction", "gone"},
		ContentPages: []string{"introduction"},
	}, docsscan.MissingPage)
}

// @scenario "One page reachable from two navigation groups is reported once"
func TestDuplicateNavEntryIsReportedOnce(t *testing.T) {
	findings := only(t, docsscan.Inputs{
		NavPages:     []string{"guide", "guide"},
		ContentPages: []string{"guide"},
	}, docsscan.DuplicateNavEntry)

	if !strings.Contains(findings[0].Problem, "2 times") {
		t.Errorf("problem %q does not say how many times it appears", findings[0].Problem)
	}
}

// @scenario "A navigation entry written with a leading slash is reported"
func TestAbsoluteNavPathIsReportedButStillResolves(t *testing.T) {
	// One finding, not two: the entry is flagged for style, and it still has to
	// resolve to its file or the report would blame the page for the slash.
	only(t, docsscan.Inputs{
		NavPages:     []string{"/cookbooks/rag"},
		ContentPages: []string{"cookbooks/rag"},
	}, docsscan.AbsoluteNavPath)
}

// @scenario "A redirect that lands on another redirect is reported"
func TestRedirectChainIsReported(t *testing.T) {
	findings := only(t, docsscan.Inputs{
		NavPages:     []string{"self-hosting/deployment/docker-compose"},
		ContentPages: []string{"self-hosting/deployment/docker-compose"},
		Redirects: []docsscan.Redirect{
			{Source: "/self-hosting/open-source", Destination: "/self-hosting/docker-compose"},
			{
				Source:      "/self-hosting/docker-compose",
				Destination: "/self-hosting/deployment/docker-compose",
			},
		},
	}, docsscan.RedirectChain)

	if !strings.Contains(findings[0].Fix, "the page the chain ends on") {
		t.Errorf("remedy %q does not say to collapse the chain", findings[0].Fix)
	}
}

// @scenario "A redirect that lands on nothing is reported"
func TestRedirectDeadEndIsReported(t *testing.T) {
	only(t, docsscan.Inputs{
		NavPages:     []string{"datasets/overview"},
		ContentPages: []string{"datasets/overview"},
		Redirects: []docsscan.Redirect{
			{Source: "/features/datasets", Destination: "/datasets/quickstart"},
		},
	}, docsscan.RedirectDeadEnd)
}

// @scenario "An off-site redirect destination is left alone"
func TestExternalRedirectIsLeftAlone(t *testing.T) {
	only(t, docsscan.Inputs{
		Redirects: []docsscan.Redirect{
			{Source: "/langevals/:path*", Destination: "https://github.com/langwatch/langevals"},
		},
	})
}

// @scenario "A redirect that carries its wildcard through to the destination is left alone"
func TestWildcardRedirectDestinationIsLeftAlone(t *testing.T) {
	// Mintlify's documented way to move a whole section. The destination is a
	// pattern, not a page, so resolving it against the page list would fail a
	// correct redirect and send the author chasing a remedy that does not apply.
	only(t, docsscan.Inputs{
		NavPages:     []string{"self-hosting/overview"},
		ContentPages: []string{"self-hosting/overview"},
		Redirects: []docsscan.Redirect{
			{Source: "/old-section/:path*", Destination: "/self-hosting/:path*"},
		},
	})
}

// @scenario "A protocol-relative redirect destination counts as off-site"
func TestProtocolRelativeRedirectIsExternal(t *testing.T) {
	only(t, docsscan.Inputs{
		Redirects: []docsscan.Redirect{
			{Source: "/blog", Destination: "//langwatch.ai/blog"},
		},
	})
}

// @scenario "An internal page whose slug begins with http is still checked"
func TestInternalDestinationBeginningWithHttpIsStillChecked(t *testing.T) {
	// A prefix test on "http" would exempt this from both redirect rules, so
	// the checker would quietly stop covering it.
	only(t, docsscan.Inputs{
		NavPages:     []string{"guides/index"},
		ContentPages: []string{"guides/index"},
		Redirects: []docsscan.Redirect{
			{Source: "/old", Destination: "/http-agents"},
		},
	}, docsscan.RedirectDeadEnd)
}

// @scenario "A release version the chart no longer ships is reported"
func TestVersionDriftIsReported(t *testing.T) {
	findings := only(t, docsscan.Inputs{
		ChartVersion: "3.12.0",
		VersionRefs: []docsscan.VersionRef{
			{File: "docs/self-hosting/deployment/docker-images.mdx", Line: 108, Version: "3.0.0"},
		},
	}, docsscan.VersionDrift)

	if findings[0].Where != "docs/self-hosting/deployment/docker-images.mdx:108" {
		t.Errorf("reported at %q, want the file and line", findings[0].Where)
	}
	if !strings.Contains(findings[0].Fix, "3.12.0") {
		t.Errorf("remedy %q does not name the release the chart ships", findings[0].Fix)
	}
}

func TestVersionMatchingTheChartIsSound(t *testing.T) {
	only(t, docsscan.Inputs{
		ChartVersion: "3.12.0",
		VersionRefs: []docsscan.VersionRef{
			{File: "docs/a.mdx", Line: 3, Version: "3.12.0"},
		},
	})
}

func TestWithoutAChartVersionTheRuleJudgesNothing(t *testing.T) {
	only(t, docsscan.Inputs{
		VersionRefs: []docsscan.VersionRef{
			{File: "docs/a.mdx", Line: 3, Version: "3.0.0"},
		},
	})
}

func TestAPageInTheNavigationWithAFileIsSound(t *testing.T) {
	only(t, docsscan.Inputs{
		NavPages:     []string{"introduction"},
		ContentPages: []string{"introduction"},
	})
}

func TestRedirectOntoARealPageIsSound(t *testing.T) {
	only(t, docsscan.Inputs{
		NavPages:     []string{"datasets/overview"},
		ContentPages: []string{"datasets/overview"},
		Redirects: []docsscan.Redirect{
			{Source: "/features/datasets", Destination: "/datasets/overview"},
		},
	})
}

// @scenario "A version that is not a LangWatch release is left alone"
func TestUnrelatedVersionsAreNotFound(t *testing.T) {
	refs := docsscan.FindVersionRefs(
		"docs/page.mdx",
		"Requires Kind v0.20.0 and Python 3.11.0, and helm 3.14.2.\n",
	)
	if len(refs) != 0 {
		t.Errorf("found %d versions, want none", len(refs))
	}
}

// @scenario "A pinned release for another project's chart is left alone"
func TestOtherProjectsChartVersionIsLeftAlone(t *testing.T) {
	// `--version`, `tag:` and `targetRevision:` are generic on their own. If the
	// rule fired on them regardless of context, it would tell an author to
	// change cert-manager's version to the LangWatch release.
	refs := docsscan.FindVersionRefs(
		"docs/page.mdx",
		"helm install cert-manager jetstack/cert-manager \\\n  --version 1.14.5 \\\n",
	)
	if len(refs) != 0 {
		t.Errorf("found %d versions, want none — no LangWatch chart is named nearby", len(refs))
	}
}

// @scenario "A placeholder tag cannot drift"
func TestPlaceholderTagIsNotFound(t *testing.T) {
	refs := docsscan.FindVersionRefs(
		"docs/page.mdx",
		"image: langwatch/langwatch:<previous-version>\n",
	)
	if len(refs) != 0 {
		t.Errorf("found %d versions, want none", len(refs))
	}
}

func TestFindVersionRefs(t *testing.T) {
	tests := []struct {
		name     string
		contents string
		want     []string
	}{
		{
			name:     "finds a tagged LangWatch image",
			contents: "docker pull langwatch/langwatch_nlp:3.12.0\n",
			want:     []string{"3.12.0"},
		},
		{
			name: "finds a Helm values image tag",
			contents: "images:\n  app:\n    repository: registry.example.com/langwatch/langwatch\n" +
				"    tag: \"3.12.0\"\n",
			want: []string{"3.12.0"},
		},
		{
			name:     "finds the version a shell example sets",
			contents: "VERSION=3.12.0\ndocker pull \"langwatch/langwatch:$VERSION\"\n",
			want:     []string{"3.12.0"},
		},
		{
			name: "finds every version in a file, in order",
			contents: "VERSION=1.2.3\n" +
				"docker pull \"langwatch/langwatch:$VERSION\"\n" +
				"    repository: langwatch/langwatch\n" +
				"    tag: \"4.5.6\"\n",
			want: []string{"1.2.3", "4.5.6"},
		},
		{
			name:     "finds a pinned chart release in a helm command",
			contents: "helm upgrade langwatch langwatch/langwatch \\\n  --version 3.12.0 \\\n",
			want:     []string{"3.12.0"},
		},
		{
			name:     "finds the chart revision an ArgoCD Application tracks",
			contents: "    chart: langwatch\n    targetRevision: 3.12.0\n",
			want:     []string{"3.12.0"},
		},
		{
			// Otherwise the remedy would tell an author to change another
			// project's version to the LangWatch release, corrupting the page.
			name:     "ignores a pinned release for someone else's chart",
			contents: "helm install cert-manager jetstack/cert-manager \\\n  --version 1.14.5 \\\n",
			want:     nil,
		},
		{
			name:     "ignores an ArgoCD Application tracking another chart",
			contents: "    chart: prometheus\n    targetRevision: 25.8.0\n",
			want:     nil,
		},
		{
			name:     "ignores a tag in an unrelated values block",
			contents: "image:\n  repository: jetstack/cert-manager\n  tag: \"1.14.5\"\n",
			want:     nil,
		},
		{
			// The context may sit either side: a helm command precedes its
			// `--version` continuation, while `VERSION=` precedes the loop that
			// names the images.
			name:     "finds a version whose chart reference comes after it",
			contents: "VERSION=3.12.0\nfor i in a; do\n  docker pull \"langwatch/langwatch:$VERSION\"\ndone\n",
			want:     []string{"3.12.0"},
		},
		{
			// `targetRevision: main` tracks a branch, not a release.
			name:     "ignores a branch-tracking targetRevision",
			contents: "    targetRevision: main\n",
			want:     nil,
		},
		{
			// clickhouse-serverless is versioned independently of the chart, so
			// holding it to appVersion would fire on a correct reference.
			name:     "ignores an independently versioned LangWatch image",
			contents: "image: langwatch/clickhouse-serverless:0.2.0\n",
			want:     nil,
		},
		{
			// The tag has to be paired with its own repository, not with any
			// nearby mention of LangWatch: this block is correct at 0.2.0.
			name: "ignores a tag belonging to an independently versioned image",
			contents: "clickhouse:\n  image:\n" +
				"    repository: langwatch/clickhouse-serverless\n" +
				"    tag: \"0.2.0\"\n",
			want: nil,
		},
		{
			name: "still finds a tag belonging to a release-tracking image",
			contents: "app:\n  image:\n" +
				"    repository: registry.example.com/langwatch/langwatch\n" +
				"    tag: \"3.12.0\"\n",
			want: []string{"3.12.0"},
		},
		{
			// Every page linking to the repository would otherwise count as
			// chart context, which is most of the site.
			name:     "a GitHub source link is not chart context",
			contents: "See [the repo](https://github.com/langwatch/langwatch).\n--version 1.14.5\n",
			want:     nil,
		},
		{
			name:     "an unrelated repoURL containing langwatch is not chart context",
			contents: "    repoURL: https://charts.example.com/langwatch-mirror\n    targetRevision: 9.1.0\n",
			want:     nil,
		},
		{
			name:     "still finds the three release-tracking images",
			contents: "langwatch/langwatch:1.1.1 langwatch/langwatch_nlp:2.2.2 langwatch/langevals:3.3.3\n",
			want:     []string{"1.1.1", "2.2.2", "3.3.3"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			refs := docsscan.FindVersionRefs("docs/page.mdx", test.contents)
			got := make([]string, 0, len(refs))
			for _, ref := range refs {
				got = append(got, ref.Version)
			}
			if len(got) != len(test.want) {
				t.Fatalf("FindVersionRefs() found %v, want %v", got, test.want)
			}
			for i := range got {
				if got[i] != test.want[i] {
					t.Errorf("FindVersionRefs()[%d] = %q, want %q", i, got[i], test.want[i])
				}
			}
		})
	}
}

func TestFindVersionRefsReportsFileAndLine(t *testing.T) {
	refs := docsscan.FindVersionRefs(
		"docs/page.mdx",
		"a\ndocker pull \"langwatch/langwatch:$VERSION\"\nVERSION=9.9.9\n",
	)
	if len(refs) != 1 {
		t.Fatalf("found %d refs, want 1", len(refs))
	}
	if refs[0].File != "docs/page.mdx" || refs[0].Line != 3 {
		t.Errorf("ref at %s:%d, want docs/page.mdx:3", refs[0].File, refs[0].Line)
	}
}

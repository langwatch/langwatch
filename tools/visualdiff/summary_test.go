package visualdiff

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// @scenario "summary.txt counts every class per edition and names the worst findings"
func TestSummaryCountsEveryClassPerEditionAndNamesTheWorstFindings(t *testing.T) {
	rows := []Row{
		{Edition: EditionEnterprise, Kind: "route", Key: "/{slug}/datasets", Class: ClassControls, Why: `controls differ: -button "Save"`,
			Base:      &Capture{URL: "http://b/p/datasets"},
			Candidate: &Capture{URL: "http://c/p/datasets", FailedRequests: []string{"500 GET /api/trpc/dataset.list?batch=1"}},
			Text:      TextDiff{Compared: true, Missing: []string{`button "Save"`}}},
		{Edition: EditionFree, Kind: "route", Key: "/{slug}/traces", Class: ClassRegression, Why: "candidate failed",
			Base: &Capture{}, Candidate: &Capture{URL: "http://c/p/traces"}},
		{Edition: EditionFree, Kind: "route", Key: "/{slug}/analytics", Class: ClassNoise},
	}
	coverage := ComputeCoverage(CoverageInputs{Base: []string{"/settings/profile", "/{slug}/datasets"}, Routes: []string{"/{slug}/datasets"}})

	summary := RenderSummary(SummaryInputs{
		BaseRef: "origin/main", CandidateRef: "HEAD", Editions: []Edition{EditionEnterprise, EditionFree},
		Rows: rows, Coverage: &coverage,
	})

	mustContain(t, summary, "3 screens, 3 findings")
	mustContain(t, summary, "coverage 1/2 (0 excluded, 1 uncovered)")
	mustContain(t, summary, "  enterprise         free")
	mustContain(t, summary, "! regression                  0            1")
	mustContain(t, summary, "  noise                       0            1")
	regression := strings.Index(summary, "[free] regression /{slug}/traces")
	controls := strings.Index(summary, "[enterprise] controls /{slug}/datasets")
	if regression < 0 || controls < 0 || regression > controls {
		t.Fatalf("findings are listed worst first:\n%s", summary)
	}
	mustContain(t, summary, "url /p/datasets")
	mustContain(t, summary, "req 500 GET /api/trpc/dataset.list")
	mustContain(t, summary, `controls -button "Save"`)
	mustContain(t, summary, "/settings/profile (static, base)")

	runDir := t.TempDir()
	if err := WriteSummaryFile(runDir, summary); err != nil {
		t.Fatal(err)
	}
	if written, _ := os.ReadFile(filepath.Join(runDir, SummaryFile)); string(written) != summary {
		t.Fatal("summary.txt is the rendered summary")
	}
}

// @scenario "findings.md lists findings only"
func TestFindingsMarkdownListsFindingsOnly(t *testing.T) {
	rows := []Row{
		{Kind: "route", Key: "/{slug}/traces", Class: ClassBlank, Why: "the candidate renders a blank page", Base: &Capture{}, Candidate: &Capture{}},
		{Kind: "route", Key: "/{slug}/analytics", Class: ClassChanged, Why: "differs by 30.00%"},
	}

	markdown := renderMarkdown(rows, ReportMeta{BaseRef: "origin/main", CandidateRef: "HEAD"})

	mustContain(t, markdown, "/{slug}/traces")
	if strings.Contains(markdown, "/{slug}/analytics") {
		t.Fatalf("a changed row is not a finding:\n%s", markdown)
	}
}

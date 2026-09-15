package visualdiff

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// @scenario A route missing on the base and present on the candidate is an intended restore
func TestClassifyIntendedRestore(t *testing.T) {
	row := Row{
		Base:      &Capture{Side: "base", NotFound: true},
		Candidate: &Capture{Side: "candidate"},
		Ratio:     0.63,
	}

	class, why := Classify(row)

	if class != ClassIntendedRestore {
		t.Fatalf("got %s (%s)", class, why)
	}
}

// @scenario A candidate console 404 on an API call is a restore gap
func TestClassifyRestoreGap(t *testing.T) {
	row := Row{
		Base:      &Capture{Side: "base"},
		Candidate: &Capture{Side: "candidate", FailedRequests: []string{"404 GET /api/governance/catalog"}},
		Ratio:     0.4,
	}

	class, why := Classify(row)

	if class != ClassRestoreGap {
		t.Fatalf("got %s (%s)", class, why)
	}
	mustContain(t, why, "/api/governance/catalog")
}

// @scenario A candidate console 404 on an API call is a restore gap
func TestAFailedRequestBothSidesShareIsNotARestoreGap(t *testing.T) {
	shared := []string{"404 GET /api/governance/catalog"}
	row := Row{
		Base:      &Capture{Side: "base", FailedRequests: shared},
		Candidate: &Capture{Side: "candidate", FailedRequests: shared},
		Ratio:     0.4,
	}

	class, _ := Classify(row)

	if class == ClassRestoreGap {
		t.Fatal("a 404 both refs already had is not a gap this branch opened")
	}
}

// @scenario A candidate page error is a regression
func TestClassifyRegression(t *testing.T) {
	thrown := Row{
		Base:      &Capture{Side: "base"},
		Candidate: &Capture{Side: "candidate", ConsoleErrors: []string{"pageerror: cannot read properties of undefined"}},
	}
	failed := Row{
		Base:      &Capture{Side: "base"},
		Candidate: &Capture{Side: "candidate", Error: "click Create automation: timeout"},
	}

	for name, row := range map[string]Row{"page error": thrown, "step failure": failed} {
		if class, why := Classify(row); class != ClassRegression {
			t.Fatalf("%s: got %s (%s)", name, class, why)
		}
	}
}

// @scenario A candidate page error is a regression
func TestARegressionOutranksARestoredScreen(t *testing.T) {
	row := Row{
		Base:      &Capture{Side: "base", NotFound: true},
		Candidate: &Capture{Side: "candidate", ConsoleErrors: []string{"pageerror: boom"}},
	}

	class, _ := Classify(row)

	if class != ClassRegression {
		t.Fatalf("a screen that throws is a regression even where the base had none: got %s", class)
	}
}

// @scenario A small diff with no errors is noise
func TestClassifyNoise(t *testing.T) {
	quiet := Row{Base: &Capture{Side: "base"}, Candidate: &Capture{Side: "candidate"}, Ratio: 0.011}
	loud := Row{Base: &Capture{Side: "base"}, Candidate: &Capture{Side: "candidate"}, Ratio: 0.31}

	if class, why := Classify(quiet); class != ClassNoise {
		t.Fatalf("got %s (%s)", class, why)
	}
	if class, _ := Classify(loud); class != ClassChanged {
		t.Fatalf("a large error-free difference is a change to look at, not noise: got %s", class)
	}
}

// @scenario A run diffs the captures and writes a report
func TestBuildRowsPairsBothSidesAndAttachesTheDiff(t *testing.T) {
	captures := []Capture{
		{Kind: "route", Key: "/traces", Side: "base", Screenshot: "/tmp/base.png"},
		{Kind: "route", Key: "/traces", Side: "candidate", Screenshot: "/tmp/candidate.png"},
		{Kind: "flow", Key: "prompt-create", Index: 1, Label: "click New Prompt", Side: "base"},
		{Kind: "flow", Key: "prompt-create", Index: 1, Side: "candidate", Error: "timeout"},
	}
	diffs := []Diff{{Kind: "route", Key: "/traces", Ratio: 0.5, File: "/tmp/diff.png"}}

	rows := BuildRows(captures, diffs)

	if len(rows) != 2 {
		t.Fatalf("expected one row per screen: %+v", rows)
	}
	if rows[0].Class != ClassRegression || rows[0].Key != "prompt-create" {
		t.Fatalf("findings sort first: %+v", rows[0])
	}
	route := rows[1]
	if route.Base == nil || route.Candidate == nil || route.Ratio != 0.5 || route.DiffFile != "/tmp/diff.png" {
		t.Fatalf("route row: %+v", route)
	}
	if route.Base.Screenshot != "/tmp/base.png" || route.Candidate.Screenshot != "/tmp/candidate.png" {
		t.Fatalf("each row keeps both screenshots: %+v", route)
	}
	if CountFindings(rows) != 1 {
		t.Fatalf("findings: %d", CountFindings(rows))
	}
}

// @scenario A run diffs the captures and writes a report
func TestWriteReportWritesAllThreeArtefacts(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "report")
	rows := BuildRows([]Capture{
		{Kind: "route", Key: "/governance/catalog", Side: "base", NotFound: true, Screenshot: "/tmp/a.png"},
		{Kind: "route", Key: "/governance/catalog", Side: "candidate", Screenshot: "/tmp/b.png",
			FailedRequests: []string{"500 GET /api/governance/catalog"}, ConsoleErrors: []string{"boom"}},
	}, nil)
	meta := ReportMeta{BaseRef: "origin/main", CandidateRef: "HEAD", Viewport: "1440x900"}

	if err := WriteReport(dir, rows, meta); err != nil {
		t.Fatal(err)
	}

	page := readFile(t, filepath.Join(dir, "report.html"))
	mustContain(t, page, "/governance/catalog")
	mustContain(t, page, "file:///tmp/a.png")
	mustContain(t, page, "file:///tmp/b.png")
	mustContain(t, page, "500 GET /api/governance/catalog")
	mustContain(t, page, "boom")
	mustContain(t, readFile(t, filepath.Join(dir, "findings.md")), "origin/main")

	document := struct {
		Meta ReportMeta `json:"meta"`
		Rows []Row      `json:"rows"`
	}{}
	if err := json.Unmarshal([]byte(readFile(t, filepath.Join(dir, "findings.json"))), &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Rows) != 1 || document.Rows[0].Class != ClassRegression {
		t.Fatalf("findings.json: %+v", document.Rows)
	}
}

func TestReportEscapesWhatItRenders(t *testing.T) {
	rows := []Row{{Kind: "route", Key: "/x", Base: &Capture{}, Candidate: &Capture{ConsoleErrors: []string{"<img onerror=alert(1)>"}}}}

	page := renderHTML(rows, ReportMeta{})

	if strings.Contains(page, "<img onerror") {
		t.Fatal("console text was rendered as markup")
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path) // #nosec G304 -- test-owned temporary path.
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}

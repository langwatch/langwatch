package visualdiff

import (
	"strings"
	"testing"
)

func pair(base, candidate *Capture) Row {
	return Row{Kind: "route", Key: "/{slug}/datasets", Base: base, Candidate: candidate, Diffed: true}
}

// @scenario "A screen captured only on the candidate is missing-base, never changed"
func TestAScreenOnlyTheCandidateCapturedIsMissingBase(t *testing.T) {
	class, why := Classify(pair(nil, &Capture{Side: "candidate"}))

	if class != ClassMissingBase || !class.IsFinding() {
		t.Fatalf("got %s (%s)", class, why)
	}
}

// @scenario "A step that fails on both refs is a finding"
func TestAStepThatFailsOnBothRefsIsAFinding(t *testing.T) {
	row := pair(&Capture{Error: "click Save: timeout"}, &Capture{Error: "click Save: timeout"})
	row.Kind = "flow"

	class, why := Classify(row)

	if class != ClassBrokenBoth || !class.IsFinding() {
		t.Fatalf("got %s (%s)", class, why)
	}
	mustContain(t, why, "flow broken on both")
}

// @scenario "A blank page is a finding on every route"
func TestABlankPageIsAFinding(t *testing.T) {
	for _, base := range []*Capture{{}, {Blank: true}} {
		class, why := Classify(pair(base, &Capture{Blank: true}))
		if class != ClassBlank || !class.IsFinding() {
			t.Fatalf("base blank=%v: got %s (%s)", base.Blank, class, why)
		}
	}
}

// @scenario "A screen whose modules still did not load is a capture failure, not a blank page"
func TestAPageWhoseModulesDidNotLoadIsTheToolsFailureNotBlank(t *testing.T) {
	unloaded := &Capture{Blank: true, ModuleFailures: []string{"FAIL GET /@fs/repo/x.tsx net::ERR_HTTP2_PROTOCOL_ERROR"}}
	for _, row := range []Row{pair(&Capture{}, unloaded), pair(unloaded, &Capture{})} {
		class, why := Classify(row)
		if class != ClassCaptureFailed || !class.IsFinding() {
			t.Fatalf("got %s (%s)", class, why)
		}
		mustContain(t, why, "ERR_HTTP2_PROTOCOL_ERROR")
	}
}

// @scenario "A candidate ending on a different path is a finding"
func TestACandidateEndingOnADifferentPathIsAFinding(t *testing.T) {
	moved := pair(&Capture{URL: "http://base/p/datasets"}, &Capture{URL: "http://candidate/p/home"})
	if class, why := Classify(moved); class != ClassRedirect || !class.IsFinding() {
		t.Fatalf("got %s (%s)", class, why)
	}

	created := pair(
		&Capture{URL: "http://base/p/analytics/custom/cm1a2b3c4d5e6f7g8h9"},
		&Capture{URL: "http://candidate/p/analytics/custom/cm9z8y7x6w5v4u3t2s1?tab=x"},
	)
	if class, why := Classify(created); class == ClassRedirect {
		t.Fatalf("two freshly created ids are the same path: %s", why)
	}
}

// @scenario "A new failing API request is a finding whatever its status"
func TestANewFailingAPIRequestIsAFinding(t *testing.T) {
	failing := pair(&Capture{}, &Capture{FailedRequests: []string{"500 GET /api/trpc/dataset.list?batch=1&input=x"}})
	if class, why := Classify(failing); class != ClassAPIError || !class.IsFinding() {
		t.Fatalf("got %s (%s)", class, why)
	}

	shared := []string{"403 POST /api/trpc/licence.get?batch=1"}
	both := pair(&Capture{FailedRequests: shared}, &Capture{FailedRequests: []string{"403 POST /api/trpc/licence.get?batch=2"}})
	if class, why := Classify(both); class == ClassAPIError {
		t.Fatalf("a failure both refs share is not new: %s", why)
	}

	aborted := pair(&Capture{}, &Capture{FailedRequests: []string{"FAIL GET /api/trpc/x net::ERR_ABORTED"}})
	if class, _ := Classify(aborted); class == ClassAPIError {
		t.Fatal("a request the navigation aborted is not a failure")
	}
}

// @scenario "The findings stream and the report classify alike"
func TestTheFindingsStreamAndTheReportClassifyAlike(t *testing.T) {
	captures := []Capture{
		{Kind: "route", Key: "/a", Side: "base", URL: "http://b/a"},
		{Kind: "route", Key: "/a", Side: "candidate", URL: "http://c/a", FailedRequests: []string{"502 GET /api/x"}},
		{Kind: "route", Key: "/b", Side: "candidate", URL: "http://c/b"},
		{Kind: "flow", Key: "f", Index: 1, Side: "base", Error: "boom"},
		{Kind: "flow", Key: "f", Index: 1, Side: "candidate", Error: "boom"},
		{Kind: "route", Key: "/c", Side: "base", URL: "http://b/c"},
		{Kind: "route", Key: "/c", Side: "candidate", URL: "http://c/c"},
	}
	diffs := []Diff{{Kind: "route", Key: "/c", Ratio: 0.3}}
	writer := &memoryFindingsWriter{}
	tracker := newFindingsTracker(trackerInputs{Writer: writer, Modules: ModuleIndex{}, Now: fixedClock("2026-09-28T00:00:00Z")})
	for _, capture := range captures {
		tracker.onCapture(capture)
	}
	for _, diff := range diffs {
		tracker.onDiff(diff)
	}
	if err := tracker.finalize(); err != nil {
		t.Fatal(err)
	}

	streamed := map[string]Classification{}
	for _, line := range writer.lines {
		if finding, ok := line.(Finding); ok {
			streamed[finding.Route+finding.Flow] = finding.Kind
		}
	}
	for _, row := range BuildRows(captures, diffs) {
		if streamed[row.Key] != row.Class {
			t.Errorf("%s: stream says %s, report says %s", row.Key, streamed[row.Key], row.Class)
		}
	}
	if streamed["/b"] != ClassMissingBase || streamed["f"] != ClassBrokenBoth || streamed["/a"] != ClassAPIError {
		t.Fatalf("streamed = %v", streamed)
	}
}

const baseSnapshotText = `- banner:
  - link "Home":
    - /url: /p
- heading "Datasets" [level=1]
- button "Save"
- text: 12 datasets, updated 3 minutes ago
- tab "All" [selected]`

// @scenario "A control one side lacks is a finding"
func TestAControlOneSideLacksIsAFinding(t *testing.T) {
	candidate := strings.Replace(baseSnapshotText, "- button \"Save\"\n", "", 1)
	row := pair(&Capture{AriaSnapshot: baseSnapshotText}, &Capture{AriaSnapshot: candidate})

	class, why := Classify(row)

	if class != ClassControls || !class.IsFinding() {
		t.Fatalf("got %s (%s)", class, why)
	}
	mustContain(t, why, `-button "Save"`)
}

// @scenario "Different words with the same controls are copy"
func TestDifferentWordsWithTheSameControlsAreCopy(t *testing.T) {
	candidate := strings.Replace(baseSnapshotText, "- text: 12 datasets", "- text: 12 collections", 1)
	row := pair(&Capture{AriaSnapshot: baseSnapshotText}, &Capture{AriaSnapshot: candidate})

	class, why := Classify(row)

	if class != ClassCopy || class.IsFinding() {
		t.Fatalf("got %s (%s)", class, why)
	}
}

// @scenario "Dates, ids and relative times never read as a change"
func TestDatesIdsAndRelativeTimesNeverReadAsAChange(t *testing.T) {
	base := `- text: Created 2026-09-27T10:00:00Z by user_1, trace cm1a2b3c4d5e6f7g8h9, 3 minutes ago, 1,204 tokens on Sep 27, 2026`
	candidate := `- text: Created 2026-09-28T11:30:00Z by user_2, trace cm9z8y7x6w5v4u3t2s1, an hour ago, 998 tokens on Sep 28, 2026`

	diff := CompareText(base, candidate)

	if !diff.Compared || diff.CopyChanged || diff.ControlsChanged() {
		t.Fatalf("masked text differs: %+v\n%s\n%s", diff, MaskVolatile(base), MaskVolatile(candidate))
	}
	if empty := CompareText("", candidate); empty.Compared {
		t.Fatal("a side without a snapshot concludes nothing")
	}
}

// @scenario "A random id in the final path never reads as a redirect"
func TestARandomIDInTheFinalPathNeverReadsAsARedirect(t *testing.T) {
	row := pair(
		&Capture{URL: "http://base/local-dev-project/experiments/workbench/MIHy1lTc"},
		&Capture{URL: "http://candidate/local-dev-project/experiments/workbench/YMcoGt8s"},
	)

	class, why := Classify(row)

	if class == ClassRedirect {
		t.Fatalf("got %s (%s)", class, why)
	}
	if got := finalPath("http://x/local-dev-project/settings"); got != "/local-dev-project/settings" {
		t.Fatalf("a word segment was masked: %s", got)
	}
}

// @scenario "A base redirecting an operator screen to governance is expected"
func TestABaseRedirectingAnOperatorScreenToGovernanceIsExpected(t *testing.T) {
	expected := pair(&Capture{URL: "http://base/governance"}, &Capture{URL: "http://candidate/ops/backoffice/users"})
	class, why := Classify(expected)
	if class != ClassIntendedRestore || class.IsFinding() {
		t.Fatalf("got %s (%s)", class, why)
	}
	mustContain(t, why, "/ops/* to /governance")

	other := pair(&Capture{URL: "http://base/settings/directory"}, &Capture{URL: "http://candidate/settings/teams"})
	if class, why := Classify(other); class != ClassRedirect {
		t.Fatalf("an unlisted redirect: got %s (%s)", class, why)
	}
}

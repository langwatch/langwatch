package apidiff

import (
	"encoding/json"
	"testing"
)

func compare(t *testing.T, before, after SideResult) []Finding {
	t.Helper()
	return CompareResults(Comparison{Method: "GET", Path: "/api/x", Case: "read", OperationID: "op"}, before, after).Findings
}

func compareExact(before, after SideResult) ComparisonOutcome {
	return CompareResults(Comparison{Method: "GET", Path: "/api/x", Case: "read", OperationID: "op", ExactStatus: true}, before, after)
}

func findingKinds(findings []Finding) []string {
	kinds := make([]string, 0, len(findings))
	for _, finding := range findings {
		kinds = append(kinds, finding.Kind)
	}
	return kinds
}

func TestCompareEqualMaskedResponses(t *testing.T) {
	before := SideResult{Status: 200, Body: `{"id": "a", "created_at": "2026-01-01T00:00:00Z", "name": "x"}`}
	after := SideResult{Status: 200, Body: `{"name": "x", "id": "b", "created_at": "2026-02-02T00:00:00Z"}`}
	if findings := compare(t, before, after); len(findings) != 0 {
		t.Fatalf("expected no findings, got %v", findings)
	}
}

func TestCompareSameClassStatusSuppressed(t *testing.T) {
	// 200 vs 201: same class — suppressed by default, counted.
	outcome := CompareResults(Comparison{Method: "POST", Path: "/api/x", Case: "mutation"}, SideResult{Status: 200, Body: `{}`}, SideResult{Status: 201, Body: `{}`})
	if len(outcome.Findings) != 0 {
		t.Fatalf("same-class status diff must be suppressed, got %v", outcome.Findings)
	}
	if outcome.Suppressed.SameClassStatus != 1 {
		t.Fatalf("suppressed count = %v, want 1", outcome.Suppressed)
	}
	// Exact mode keeps the finding.
	exact := compareExact(SideResult{Status: 200, Body: `{}`}, SideResult{Status: 201, Body: `{}`})
	if len(exact.Findings) != 1 || exact.Findings[0].Kind != FindingStatusDiff {
		t.Fatalf("exact mode findings = %v", findingKinds(exact.Findings))
	}
	if exact.Findings[0].Fields["status"] != [2]any{200, 201} {
		t.Fatalf("status fields = %v", exact.Findings[0].Fields)
	}
	if _, ok := exact.Findings[0].Fields["class"]; ok {
		t.Fatal("same-class status diff must not carry a class field")
	}
}

func TestCompareStatusDiffClass(t *testing.T) {
	findings := compare(t, SideResult{Status: 200, Body: `{}`}, SideResult{Status: 404, Body: `{}`})
	if len(findings) == 0 || findings[0].Kind != FindingStatusDiff {
		t.Fatalf("findings = %v", findingKinds(findings))
	}
	if findings[0].Fields["class"] != [2]any{"success", "client-error"} {
		t.Fatalf("class fields = %v", findings[0].Fields["class"])
	}
}

func TestCompareBodyShapeDiff(t *testing.T) {
	before := SideResult{Status: 200, Body: `{"name": "x"}`}
	after := SideResult{Status: 200, Body: `{"name": "x", "extra": 1}`}
	findings := compare(t, before, after)
	if len(findings) != 1 || findings[0].Kind != FindingBodyShapeDiff {
		t.Fatalf("findings = %v, want body_shape_diff", findingKinds(findings))
	}
}

func TestCompareArrayLengthDiff(t *testing.T) {
	before := SideResult{Status: 200, Body: `{"items": [1]}`}
	after := SideResult{Status: 200, Body: `{"items": [1, 2]}`}
	findings := compare(t, before, after)
	if len(findings) != 1 || findings[0].Kind != FindingBodyShapeDiff {
		t.Fatalf("findings = %v, want body_shape_diff for array length", findingKinds(findings))
	}
}

func TestCompareErrorBodiesSuppressed(t *testing.T) {
	// Both sides error with different envelopes and codes: nothing is a
	// finding by default; both suppressions are counted.
	before := SideResult{Status: 400, Body: `{"error": "bad_request", "message": "name required"}`}
	after := SideResult{Status: 422, Body: `{"error": "validation", "fields": {"name": ["required"]}}`}
	outcome := CompareResults(Comparison{Method: "POST", Path: "/api/x", Case: "validation"}, before, after)
	if len(outcome.Findings) != 0 {
		t.Fatalf("error churn must not be a finding, got %v", outcome.Findings)
	}
	if outcome.Suppressed.SameClassStatus != 1 || outcome.Suppressed.ErrorBody != 1 {
		t.Fatalf("suppressed = %+v, want 1+1", outcome.Suppressed)
	}

	// Exact mode compares them: status_diff plus error_shape_diff.
	exact := compareExact(before, after)
	kinds := findingKinds(exact.Findings)
	want := []string{FindingStatusDiff, FindingErrorShapeDiff}
	if len(kinds) != len(want) {
		t.Fatalf("exact kinds = %v, want %v", kinds, want)
	}
	for index := range want {
		if kinds[index] != want[index] {
			t.Fatalf("exact kinds = %v, want %v", kinds, want)
		}
	}
}

func TestCompareBodyValueDiff(t *testing.T) {
	before := SideResult{Status: 200, Body: `{"config": {"retries": 3, "mode": "fast"}}`}
	after := SideResult{Status: 200, Body: `{"config": {"retries": 5, "mode": "fast"}}`}
	findings := compare(t, before, after)
	if len(findings) != 1 || findings[0].Kind != FindingBodyValueDiff {
		t.Fatalf("findings = %v, want body_value_diff", findingKinds(findings))
	}
	got := findings[0].Fields["/config/retries"]
	if got[0] != json.Number("3") || got[1] != json.Number("5") {
		t.Fatalf("value fields = %v", findings[0].Fields)
	}
}

func TestCompareProbeFailed(t *testing.T) {
	findings := compare(t, SideResult{Error: "dial tcp: connection refused"}, SideResult{Status: 200, Body: `{}`})
	if len(findings) != 1 || findings[0].Kind != FindingProbeFailed {
		t.Fatalf("findings = %v, want probe_failed", findingKinds(findings))
	}
}

func TestCompareNonJSONBodies(t *testing.T) {
	if findings := compare(t, SideResult{Status: 200, Body: "plain"}, SideResult{Status: 200, Body: "plain"}); len(findings) != 0 {
		t.Fatalf("equal plain text must not diff: %v", findings)
	}
	findings := compare(t, SideResult{Status: 200, Body: "yes"}, SideResult{Status: 200, Body: "no"})
	if len(findings) != 1 || findings[0].Kind != FindingBodyValueDiff {
		t.Fatalf("findings = %v, want body_value_diff", findingKinds(findings))
	}
}

func TestCompareOneSidedErrorSkipsBody(t *testing.T) {
	// 200 vs 500: status_diff covers it; the body comparison is skipped but
	// not counted as an error-body suppression (only both-errored counts).
	before := SideResult{Status: 200, Body: `{"ok": true}`}
	after := SideResult{Status: 500, Body: `{"error": "boom"}`}
	outcome := CompareResults(Comparison{Method: "GET", Path: "/api/x", Case: "read"}, before, after)
	if len(outcome.Findings) != 1 || outcome.Findings[0].Kind != FindingStatusDiff {
		t.Fatalf("findings = %v", findingKinds(outcome.Findings))
	}
	if outcome.Suppressed.ErrorBody != 0 {
		t.Fatalf("one-sided error must not count as error-body suppression: %+v", outcome.Suppressed)
	}
}

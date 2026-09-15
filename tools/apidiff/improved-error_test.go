package apidiff

import (
	"strings"
	"testing"
)

// nestedErrorBody is the REST wrapper shape (packages/api/src/rest/response.ts's
// apiErrorBody): {"error":{"code":...}}.
func nestedErrorBody(code string) string {
	return `{"error":{"type":"unprocessable_entity","code":"` + code + `","message":"m","retryable":false}}`
}

// flatErrorBody is packages/api/src/errors.ts's ErrorResponseBody shape:
// {"code":...} at the top level.
func flatErrorBody(code string) string {
	return `{"code":"` + code + `","message":"m","retryable":false}`
}

func TestImprovedErrorQualifies(t *testing.T) {
	cases := []struct {
		name     string
		before   SideResult
		after    SideResult
		wantCode string
	}{
		{
			name:     "generic 500 nested envelope -> 422 with nested code and field reasons",
			before:   SideResult{Status: 500, Body: nestedErrorBody("internal_error")},
			after:    SideResult{Status: 422, Body: `{"error":{"type":"unprocessable_entity","code":"validation_error","message":"m","meta":{"reasons":[{"code":"required"}]},"retryable":false}}`},
			wantCode: "validation_error",
		},
		{
			name:     "generic 500 flat envelope -> 400 with flat code",
			before:   SideResult{Status: 500, Body: flatErrorBody("internal_error")},
			after:    SideResult{Status: 400, Body: flatErrorBody("bad_request")},
			wantCode: "bad_request",
		},
		{
			name:     "unrecognizable-envelope 500 -> 400 with a code: status alone is enough to own the base failure",
			before:   SideResult{Status: 500, Body: `not json at all`},
			after:    SideResult{Status: 400, Body: flatErrorBody("bad_request")},
			wantCode: "bad_request",
		},
		{
			name:     "503 base carrying the generic code (still owned by status class, not just the code)",
			before:   SideResult{Status: 503, Body: nestedErrorBody("internal_error")},
			after:    SideResult{Status: 404, Body: nestedErrorBody("not_found")},
			wantCode: "not_found",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			findings := compare(t, testCase.before, testCase.after)
			if len(findings) != 1 || findings[0].Kind != FindingErrorImproved {
				t.Fatalf("findings = %v, want a single error_improved finding", findingKinds(findings))
			}
			code := findings[0].Fields["code"]
			if code[1] != testCase.wantCode {
				t.Fatalf("code field = %v, want after=%q", code, testCase.wantCode)
			}
			status := findings[0].Fields["status"]
			if status[0] != testCase.before.Status || status[1] != testCase.after.Status {
				t.Fatalf("status field = %v, want [%d, %d]", status, testCase.before.Status, testCase.after.Status)
			}
		})
	}
}

// TestImprovedErrorNotQualified is the qualification matrix's NOT-improved
// half: one case per manifest bullet, each proving the acceptance grants
// nothing outside the single direction it names.
func TestImprovedErrorNotQualified(t *testing.T) {
	cases := []struct {
		name   string
		before SideResult
		after  SideResult
	}{
		{
			name:   "reverse: main clean 4xx -> branch 5xx stays handled-refusal-degraded, never improved",
			before: SideResult{Status: 401, Body: nestedErrorBody("unauthorized")},
			after:  SideResult{Status: 500, Body: nestedErrorBody("internal_error")},
		},
		{
			name:   "main 2xx -> branch anything is never improved",
			before: SideResult{Status: 200, Body: `{"ok":true}`},
			after:  SideResult{Status: 400, Body: flatErrorBody("bad_request")},
		},
		{
			name:   "main 4xx -> branch 2xx is a product decision, not an auto-accept",
			before: SideResult{Status: 402, Body: nestedErrorBody("enterprise_plan_required")},
			after:  SideResult{Status: 200, Body: `{"ok":true}`},
		},
		{
			name:   "branch 5xx of any kind, even a named handled 503, is never accepted",
			before: SideResult{Status: 401, Body: nestedErrorBody("unauthorized")},
			after:  SideResult{Status: 503, Body: nestedErrorBody("rate_limited_by_provider")},
		},
		{
			name:   "ambiguous base: not literally 5xx, and its body cannot be classified as the generic envelope",
			before: SideResult{Status: 499, Body: `not json at all`},
			after:  SideResult{Status: 400, Body: flatErrorBody("bad_request")},
		},
		{
			name:   "ambiguous candidate: a 4xx base-owned failure improves to but the body carries no code at all",
			before: SideResult{Status: 500, Body: nestedErrorBody("internal_error")},
			after:  SideResult{Status: 400, Body: `{"message":"nope"}`},
		},
		{
			name:   "candidate code is itself the generic placeholder: not a stable code to improve TO",
			before: SideResult{Status: 500, Body: nestedErrorBody("internal_error")},
			after:  SideResult{Status: 400, Body: flatErrorBody("internal_error")},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			findings := compare(t, testCase.before, testCase.after)
			for _, finding := range findings {
				if finding.Kind == FindingErrorImproved {
					t.Fatalf("must not classify as improved: %v", findings)
				}
			}
		})
	}
}

// TestImprovedErrorSameClassStays401To402NeverImproved covers the same-class
// 4xx->4xx bullet under -exact-status, where compareStatus's differing-class
// branch (and so classifyImprovedError) is never even reached.
func TestImprovedErrorSameClass401To402NeverImproved(t *testing.T) {
	before := SideResult{Status: 401, Body: nestedErrorBody("unauthorized")}
	after := SideResult{Status: 402, Body: nestedErrorBody("enterprise_plan_required")}
	outcome := compareExact(before, after)
	kinds := findingKinds(outcome.Findings)
	if len(kinds) == 0 || kinds[0] != FindingStatusDiff {
		t.Fatalf("findings = %v, want status_diff first (same-class 4xx->4xx is drift, not improvement)", kinds)
	}
	for _, kind := range kinds {
		if kind == FindingErrorImproved {
			t.Fatalf("findings = %v, a same-class code swap must never be error_improved", kinds)
		}
	}
}

func TestImprovedErrorRootCauseAndNamespace(t *testing.T) {
	finding := statusFinding(FindingErrorImproved, "GET", "/x", 500, 422)
	if got := RootCause(finding); got != "error-improved:500-422" {
		t.Fatalf("RootCause = %q, want error-improved:500-422", got)
	}
	finding.Case = entitledCaseName
	if got := RootCause(finding); got != "entitled:error-improved:500-422" {
		t.Fatalf("RootCause (entitled) = %q, want entitled:error-improved:500-422", got)
	}
	if !isAcceptedImprovement("error-improved:500-422") {
		t.Fatal("bare error-improved cause must be accepted")
	}
	if !isAcceptedImprovement("entitled:error-improved:500-422") {
		t.Fatal("entitled-namespaced error-improved cause must be accepted")
	}
	if isAcceptedImprovement("handled-refusal-degraded:401-500") {
		t.Fatal("an unrelated cause must not be accepted")
	}
	if isAcceptedImprovement("entitled:handled-refusal-degraded:401-500") {
		t.Fatal("an unrelated entitled-namespaced cause must not be accepted")
	}
}

// TestImprovedErrorLedgerIsExitNeutralWithoutABaseline is the acceptance's
// whole point: an improved-error finding needs no -ledger-baseline entry to
// stop failing the run, unlike every other cause.
func TestImprovedErrorLedgerIsExitNeutralWithoutABaseline(t *testing.T) {
	report := Report{Findings: []Finding{statusFinding(FindingErrorImproved, "GET", "/api/x", 500, 422)}}
	ledger := BuildLedger([]Operation{{Method: "GET", Path: "/api/x", InA: true, InB: true}}, report, nil)
	if ledger.Totals.NewCauses != 0 {
		t.Fatalf("newCauses = %d, want 0 with no baseline at all", ledger.Totals.NewCauses)
	}
	if ledger.Totals.KnownCauses != 1 {
		t.Fatalf("knownCauses = %d, want 1", ledger.Totals.KnownCauses)
	}
	if len(ledger.Causes) != 1 || !ledger.Causes[0].Known {
		t.Fatalf("causes = %+v, want the sole cause marked known", ledger.Causes)
	}
	if len(ledger.Operations) != 1 || !ledger.Operations[0].Known {
		t.Fatalf("operations = %+v, want the sole row marked known", ledger.Operations)
	}
}

// TestImprovedErrorReportIsExitNeutral proves the OTHER exit path: without
// -ledger-baseline at all, apidiff's exit code comes from report.Differences,
// and an improved-error finding must not add to it.
func TestImprovedErrorReportIsExitNeutral(t *testing.T) {
	report := BuildReport(nil, ProbeResult{
		Findings: []Finding{statusFinding(FindingErrorImproved, "GET", "/api/x", 500, 422)},
		Probed:   1,
	})
	if report.Differences != 0 {
		t.Fatalf("differences = %d, want 0 for a run with only an improved-error finding", report.Differences)
	}

	var summary strings.Builder
	if err := WriteHumanSummary(&summary, report); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(summary.String(), "no behavioral differences") {
		t.Fatalf("summary must report no differences: %s", summary.String())
	}
	if !strings.Contains(summary.String(), "error_improved") {
		t.Fatalf("summary must still surface the improved-error finding, so a reader can see it at a glance: %s", summary.String())
	}
	if !strings.Contains(summary.String(), "improved: 1 operation") {
		t.Fatalf("summary must count the improvement: %s", summary.String())
	}
}

// TestImprovedErrorNotAcceptedFindingStillFailsWithoutBaseline is the
// control: an ordinary status_diff must still add to Differences, so the
// exemption above is provably scoped to error_improved alone.
func TestImprovedErrorNotAcceptedFindingStillFailsWithoutBaseline(t *testing.T) {
	report := BuildReport(nil, ProbeResult{
		Findings: []Finding{statusFinding(FindingStatusDiff, "GET", "/api/x", 401, 500)},
		Probed:   1,
	})
	if report.Differences != 1 {
		t.Fatalf("differences = %d, want 1 for an ordinary status_diff", report.Differences)
	}
}

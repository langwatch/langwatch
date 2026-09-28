package apidiff

import (
	"strings"
	"testing"
)

func compareOperation(method, path, before, after string) []Finding {
	return CompareResults(Comparison{Method: method, Path: path, Case: "read"},
		SideResult{Status: 200, Body: before}, SideResult{Status: 200, Body: after}).Findings
}

func onlyFinding(t *testing.T, findings []Finding, kind string) Finding {
	t.Helper()
	if len(findings) != 1 || findings[0].Kind != kind {
		t.Fatalf("want one %s finding, got %+v", kind, findings)
	}
	return findings[0]
}

func TestRulingRulesAShapeDeltaAtItsPointer(t *testing.T) {
	findings := compareOperation("GET", "/api/annotations/{id}",
		`{"data":{"comment":"c","scoreOptions":null}}`, `{"data":{"comment":"c","scoreOptions":{}}}`)

	ruled := onlyFinding(t, findings, FindingRuled)
	if !strings.HasPrefix(ruled.Reason, FindingBodyShapeDiff+": main writes {}") {
		t.Fatalf("reason = %q", ruled.Reason)
	}
	if pair, ok := ruled.Fields["/data/scoreOptions"]; !ok || pair != [2]any{"null", "object"} {
		t.Fatalf("fields = %v", ruled.Fields)
	}
}

func TestRulingLeavesAShapeFindingWithAnUnruledDelta(t *testing.T) {
	findings := compareOperation("GET", "/api/annotations/{id}",
		`{"data":{"comment":"c","scoreOptions":null}}`, `{"data":{"scoreOptions":{}}}`)

	onlyFinding(t, findings, FindingBodyShapeDiff)
}

func TestRulingIsDirectional(t *testing.T) {
	findings := compareOperation("GET", "/api/annotations/{id}",
		`{"data":{"scoreOptions":{}}}`, `{"data":{"scoreOptions":null}}`)

	onlyFinding(t, findings, FindingBodyShapeDiff)
}

func TestRulingIsScopedToItsOperation(t *testing.T) {
	findings := compareOperation("GET", "/api/other",
		`{"data":{"scoreOptions":null}}`, `{"data":{"scoreOptions":{}}}`)

	onlyFinding(t, findings, FindingBodyShapeDiff)
}

func TestRulingRulesAGrownCatalogueButNotAShrunkOne(t *testing.T) {
	grown := compareOperation("GET", "/api/roles/permissions",
		`{"actions":["view"],"resources":[{"actions":["view"]}]}`,
		`{"actions":["view","manage"],"resources":[{"actions":["view","manage"]},{"actions":["view"]}]}`)
	onlyFinding(t, grown, FindingRuled)

	shrunk := compareOperation("GET", "/api/roles/permissions",
		`{"actions":["view","manage"],"resources":[]}`, `{"actions":["view"],"resources":[]}`)
	onlyFinding(t, shrunk, FindingBodyShapeDiff)
}

func TestRulingCoversTheCheckupUsageReportSubtree(t *testing.T) {
	findings := compareOperation("GET", "/api/checkup",
		`{"rows":[{"verdict":{"outcome":"pass","detail":"d"}}],"usageReport":{"disabled":false,"payload":{"a":1}}}`,
		`{"rows":[{"verdict":{"outcome":"pass"}}],"usageReport":{"payload":{"b":2}}}`)

	onlyFinding(t, findings, FindingRuled)
}

func TestRulingSplitsAValueFindingByPointer(t *testing.T) {
	findings := compareOperation("GET", "/api/organization/members",
		`{"members":[{"role":"ADMIN","user":{"email":"admin@haven.localhost"}}]}`,
		`{"members":[{"role":"MEMBER","user":{"email":"admin@mail.langwatch.localhost"}}]}`)

	if len(findings) != 2 {
		t.Fatalf("want a kept and a ruled finding, got %+v", findings)
	}
	kept, ruled := findings[0], findings[1]
	if kept.Kind != FindingBodyValueDiff || len(kept.Fields) != 1 || kept.Fields["/members/0/role"] == [2]any{} {
		t.Fatalf("kept = %+v", kept)
	}
	if ruled.Kind != FindingRuled || ruled.Fields["/members/0/user/email"] == [2]any{} {
		t.Fatalf("ruled = %+v", ruled)
	}
}

func TestRulingKeepsAValueOutsideItsSeedPattern(t *testing.T) {
	findings := compareOperation("GET", "/api/organization/members",
		`{"members":[{"user":{"email":"admin@haven.localhost"}}]}`,
		`{"members":[{"user":{"email":"someone@example.com"}}]}`)

	onlyFinding(t, findings, FindingBodyValueDiff)
}

func TestRulingRulesCutBodiesThatDifferOnlyByDatabaseName(t *testing.T) {
	cut := func(database string) string {
		body := `{"database":"` + database + `","functions":["` + strings.Repeat("abs", bodyCaptureCap) + `"]}`
		return body[:bodyCaptureCap]
	}
	findings := compareOperation("GET", "/api/query/schema", cut("apidiff_apidiff_run44_main"), cut("apidiff_apidiff_run44_branch"))
	onlyFinding(t, findings, FindingRuled)

	other := cut("apidiff_apidiff_run44_branch")
	other = other[:100] + "X" + other[101:]
	findings = compareOperation("GET", "/api/query/schema", cut("apidiff_apidiff_run44_main"), other)
	onlyFinding(t, findings, FindingBodyValueDiff)
}

func TestRuledFindingsLeaveTheDifferenceCountAndTheLedger(t *testing.T) {
	ruled := Finding{Kind: FindingRuled, Method: "GET", Path: "/api/annotations/{id}", Reason: "body_shape_diff: x"}
	report := BuildReport(nil, ProbeResult{Findings: []Finding{ruled}})
	if report.Differences != 0 {
		t.Fatalf("differences = %d, want 0", report.Differences)
	}
	var summary strings.Builder
	if err := WriteHumanSummary(&summary, report); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(summary.String(), "ruled (1):") || !strings.Contains(summary.String(), "ruled: 1 body difference(s)") {
		t.Fatalf("summary does not list the ruling:\n%s", summary.String())
	}
	ledger := BuildLedger([]Operation{{Method: "GET", Path: "/api/annotations/{id}"}}, report, nil)
	for _, row := range ledger.Operations {
		if row.Classification == ClassificationDiffers || len(row.RootCauses) != 0 {
			t.Fatalf("ledger row = %+v", row)
		}
	}
}

func TestRulingRulesADatabaseNameWhateverTheRunIsCalled(t *testing.T) {
	cut := func(database string) string {
		body := `{"database":"` + database + `","functions":["` + strings.Repeat("abs", bodyCaptureCap) + `"]}`
		return body[:bodyCaptureCap]
	}
	findings := compareOperation("GET", "/api/query/reference", cut("apidiff_apidiff_run45g_main"), cut("apidiff_apidiff_run45g_branch"))

	onlyFinding(t, findings, FindingRuled)
}

func TestRulingRulesTheLangyApprovalsPerSideFieldsAndKeepsTheRest(t *testing.T) {
	findings := CompareResults(Comparison{Method: "POST", Path: "/api/langy/control/requests/{requestId}/approve", Case: "mutation"},
		SideResult{Status: 200, Body: `{"sessionKey":"sk-lw-abc_1","endpoint":"http://localhost:61874","conversation":{"title":"Apidiff question"}}`},
		SideResult{Status: 200, Body: `{"sessionKey":"sk-lw-xyz-2","endpoint":"http://localhost:61873","conversation":{"title":"apidiff question"}}`}).Findings

	if len(findings) != 2 {
		t.Fatalf("want a kept and a ruled finding, got %+v", findings)
	}
	kept, ruled := findings[0], findings[1]
	if kept.Kind != FindingBodyValueDiff || len(kept.Fields) != 1 || kept.Fields["/conversation/title"] == [2]any{} {
		t.Fatalf("kept = %+v", kept)
	}
	if ruled.Kind != FindingRuled || len(ruled.Fields) != 2 {
		t.Fatalf("ruled = %+v", ruled)
	}
}

func TestRulingRulesALangyConversationLinkButNotAnotherHost(t *testing.T) {
	link := func(host, id string) string {
		return `{"requests":[{"conversationUrl":"` + host + `/local-dev-project?langyConversation=langyconv_` + id + `"}]}`
	}
	findings := compareOperation("GET", "/api/langy/control/requests", link("http://localhost:61874", "A1"), link("http://localhost:61873", "B2"))
	onlyFinding(t, findings, FindingRuled)

	findings = compareOperation("GET", "/api/langy/control/requests", link("http://localhost:61874", "A1"), link("https://example.com", "B2"))
	onlyFinding(t, findings, FindingBodyValueDiff)
}

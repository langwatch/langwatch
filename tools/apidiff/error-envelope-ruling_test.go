package apidiff

import "testing"

func TestErrorEnvelopeRuling(t *testing.T) {
	branch := func(code string) string {
		return `{"type":"not_found","code":"` + code + `","message":"m","retryable":false,"trace_id":"t","span_id":"s"}`
	}
	cases := []struct {
		name, main, branch, want string
	}{
		{"nested envelope, same code", `{"error":{"type":"not_found","code":"cache_entry_not_found","message":"m"}}`, branch("cache_entry_not_found"), FindingRuled},
		{"flat legacy code, same code", `{"error":"prompt_not_found","message":"m","fault":"customer"}`, branch("prompt_not_found"), FindingRuled},
		{"root code dialect", `{"code":"suite_not_found","message":"suite_not_found","meta":{},"reasons":[],"fault":"customer","error":"Not Found","kind":"suite_not_found","type":"suite_not_found"}`, branch("suite_not_found"), FindingRuled},
		{"sentence only", `{"error":"Scenario not found"}`, branch("scenario_not_found"), FindingRuled},
		{"code changed", `{"error":{"type":"unauthenticated","code":"langy_api_credential_missing","message":"m"}}`, branch("missing_credentials"), FindingErrorShapeDiff},
		{"protocol frame code changed", `{"frame":{"type":"refused","protocol":1,"code":"api_key_invalid","message":"m"}}`, branch("agent_register_refused"), FindingErrorShapeDiff},
		{"branch not the envelope", `{"error":"Method not allowed"}`, `{"message":"x"}`, FindingErrorShapeDiff},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			outcome := compareExact(SideResult{Status: 404, Body: testCase.main}, SideResult{Status: 404, Body: testCase.branch})
			if kinds := findingKinds(outcome.Findings); len(kinds) != 1 || kinds[0] != testCase.want {
				t.Fatalf("want [%s], got %v", testCase.want, kinds)
			}
		})
	}
}

func TestScenarioAgreementPassesARuledEnvelope(t *testing.T) {
	side := func(body string) sideOutcome {
		return sideOutcome{main: SideResult{Status: 404, Body: body}, mainSent: true}
	}
	result := &scenarioResult{
		Endpoint: "GET /api/agent-cache/{name}",
		Main:     side(`{"error":{"type":"not_found","code":"cache_entry_not_found","message":"m"}}`),
		Branch:   side(`{"type":"not_found","code":"cache_entry_not_found","message":"m","retryable":false}`),
	}
	(&scenarioRunner{}).judgeAgreement(result)
	if result.Verdict != verdictPass {
		t.Fatalf("want %s, got %s (%s)", verdictPass, result.Verdict, result.FirstFail)
	}

	result.Branch = side(`{"type":"unauthenticated","code":"missing_credentials","message":"m","retryable":false}`)
	(&scenarioRunner{}).judgeAgreement(result)
	if result.Verdict != verdictFailDiff {
		t.Fatalf("a changed code must still fail, got %s", result.Verdict)
	}
}

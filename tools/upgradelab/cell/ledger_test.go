package cell

import (
	"strings"
	"testing"
)

const fakeLedger = `## Upgrade flow

| ID | Deployment | Tenants | Data shape / volume | Status | Tested by | Date | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|
| UP-04 | Cloud, hybrid | 1 shared + 1 private | small | ⬜ | | | | |
| UP-06 | Self-hosted | 1 | small | ⬜ | | | | |

## Log

Newest first: date, flow, result, who, evidence.

- 2026-10-08 · UP-01 cloud ❌ 9/16 · someone
`

// @scenario "A cell claims its ledger row and reports its verdict to it"
func TestACellClaimsItsLedgerRowAndReportsItsVerdict(t *testing.T) {
	claimed, err := SetFlowRow(fakeLedger, "UP-04", FlowResult{Status: "⏳", TestedBy: "upgradelab hybrid_s_typical_1 run21", Date: "2026-10-09", Evidence: "run in progress"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(claimed, "| UP-04 | Cloud, hybrid | 1 shared + 1 private | small | ⏳ | upgradelab hybrid_s_typical_1 run21 | 2026-10-09 | run in progress |  |") {
		t.Fatalf("claim row wrong:\n%s", claimed)
	}
	reported, err := SetFlowRow(claimed, "UP-04", FlowResult{Status: "❌", TestedBy: "upgradelab hybrid_s_typical_1 run21", Date: "2026-10-09", Evidence: "cell `hybrid_s_typical_1`, main@e683dd9ea5 → abc + 2 local changes, run run21", Notes: "19 of 20 invariants pass. Fails: I6 (a|b)"})
	if err == nil {
		reported, err = PrependLog(reported, "- 2026-10-09 · UP-04 hybrid ❌ 19/20 (I6) · upgradelab hybrid_s_typical_1 run21")
	}
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(reported, "| ❌ | upgradelab hybrid_s_typical_1 run21 | 2026-10-09 | cell `hybrid_s_typical_1`, main@e683dd9ea5 → abc + 2 local changes, run run21 | 19 of 20 invariants pass. Fails: I6 (a/b) |") {
		t.Errorf("verdict row wrong:\n%s", reported)
	}
	if !strings.Contains(reported, "evidence.\n\n- 2026-10-09 · UP-04 hybrid ❌ 19/20 (I6) · upgradelab hybrid_s_typical_1 run21\n- 2026-10-08") {
		t.Errorf("log line not first under ## Log:\n%s", reported)
	}
	if FlowRow(reported, "UP-06") != "| UP-06 | Self-hosted | 1 | small | ⬜ | | | | |" {
		t.Error("another row was retyped")
	}
	if got := scrub("dial tcp 127.0.0.1:64561: refused at http://u:p@h/x in /Users/x/y"); strings.ContainsAny(got, "@") || strings.Contains(got, "127.0.0.1") || strings.Contains(got, "/Users/") {
		t.Errorf("scrub kept a host or path: %q", got)
	}
}

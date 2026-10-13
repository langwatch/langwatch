package cell

import (
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/upgradelab/snapshot"
)

func TestAgedInsertClonesTheSourceIntoTheTenantAtTheAge(t *testing.T) {
	spans := agedTables[1]
	got := agedInsert(agedInsertInput{Table: spans, Final: " FINAL", Source: "project_seed", Tenant: "project_o'1", Age: 95, Retention: 63})
	for _, want := range []string{"INSERT INTO stored_spans SELECT * REPLACE (", "'project_o''1' AS TenantId", "63 AS _retention_days",
		"concat(TraceId, '-aged95')", "StartTime - toIntervalDay(95) AS StartTime", "FROM stored_spans FINAL WHERE TenantId = 'project_seed'",
		"ORDER BY StartTime DESC LIMIT 25"} {
		if !strings.Contains(got, want) {
			t.Errorf("insert lacks %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "{") {
		t.Errorf("a placeholder was left unfilled:\n%s", got)
	}
	events := agedInsert(agedInsertInput{Table: agedTables[4], Source: "s", Tenant: "t", Age: 30, Retention: 49})
	if strings.Contains(events, "AS EventId") || !strings.Contains(events, "EventOccurredAt - 30 * 86400000 AS EventOccurredAt") {
		t.Errorf("event ids stay as main wrote them, only times shift:\n%s", events)
	}
}

func TestEveryAgedTableIsCountedPerSlice(t *testing.T) {
	for _, table := range agedTables {
		query := agedCountQuery(table, "", []string{"a", "b"})
		if !strings.Contains(query, "FROM "+table.Table+" WHERE TenantId IN ('a', 'b')") || !strings.Contains(query, table.At+" AS at") {
			t.Errorf("%s count query:\n%s", table.Table, query)
		}
	}
	counts := parseAgedCounts("p1\t30\t25\t0\np1\t400\t20\t20\nbroken line\n")
	if counts[agedKey{"p1", 30}] != [2]int{25, 0} || counts[agedKey{"p1", 400}] != [2]int{20, 20} || len(counts) != 2 {
		t.Errorf("parsed %v", counts)
	}
}

func TestRetentionJudgesEachSliceAgainstMainsOwnTTL(t *testing.T) {
	kept := []sliceCount{{Org: "project-rule", Kind: "spans", Slice: 30, AtCut: 25, After: 25}, {Org: "project-rule", Kind: "spans", Slice: 95, AtCut: 25, Expirable: 25, After: 0}}
	if got := judgeRetention(kept); got.Result != "pass" {
		t.Errorf("an expired slice may empty on main's TTL: %s %s", got.Result, got.Detail)
	}
	lost := append(slices.Clone(kept), sliceCount{Org: "default", Kind: "events", Slice: 61, AtCut: 25, After: 24})
	if got := judgeRetention(lost); got.Result != "fail" || !strings.Contains(got.Detail, "default events 61d 25->24") {
		t.Errorf("a kept slice that lost a row fails: %s %s", got.Result, got.Detail)
	}
	empty := append(slices.Clone(kept), sliceCount{Org: "org-rule", Kind: "logs", Slice: 30})
	if got := judgeRetention(empty); got.Result != "inconclusive" {
		t.Errorf("a slice empty at the cut proves nothing: %s", got.Result)
	}
	expired := append(slices.Clone(kept), sliceCount{Org: "org-rule", Kind: "logs", Slice: 61, Retention: 35, Seeded: 25})
	if got := judgeRetention(expired); got.Result != "pass" || !strings.Contains(got.Detail, "before the cut: [org-rule logs 61d]") {
		t.Errorf("a slice main's TTL emptied before the cut proves no upgrade loss: %s %s", got.Result, got.Detail)
	}
	if expectAfter(25, 0) != "25" || !strings.HasPrefix(expectAfter(25, 10), "15 to 25") {
		t.Errorf("expectations: %q %q", expectAfter(25, 0), expectAfter(25, 10))
	}
}

func TestCopyAllowsOnlyWhatRetentionMayExpire(t *testing.T) {
	before := snapshot.Fingerprint{"clickhouse/shared": {"stored_spans": {Count: 100}}, "clickhouse/private-eu": {"stored_spans": {Count: 10}}}
	after := snapshot.Fingerprint{"clickhouse/shared": {"stored_spans": {Count: 90}}, "clickhouse/private-eu": {"stored_spans": {Count: 10}}}
	allowance := map[string]map[string]int64{"clickhouse/shared": {"stored_spans": 10}}
	if got := judgeCopy(before, after, allowance); got.Result != "pass" || !strings.Contains(got.Detail, "expired by main's own retention TTL only") {
		t.Errorf("within the allowance: %s %s", got.Result, got.Detail)
	}
	after["clickhouse/private-eu"]["stored_spans"] = snapshot.TableFingerprint{Count: 9}
	if got := judgeCopy(before, after, allowance); got.Result != "fail" || !strings.Contains(got.Detail, "clickhouse/private-eu.stored_spans 10->9") {
		t.Errorf("a private target is judged too: %s %s", got.Result, got.Detail)
	}
}

func TestOverlaysNameTheirOwnStores(t *testing.T) {
	options := Options{Deployment: "cloud", Tier: "S", Shape: "typical", Seed: 1, Overlays: []string{OverlayRetention}}
	if got := options.Name(); got != "cloud_s_typical_1_retention" {
		t.Errorf("name %q", got)
	}
	if _, err := prepare(Options{Deployment: "cloud", Tier: "S", Shape: "typical", Overlays: []string{"bogus"}, FromDir: t.TempDir()}); err == nil {
		t.Error("an unknown overlay must be refused")
	}
}

func TestEmptyOriginDataStepsEndDoneOverZeroRows(t *testing.T) {
	rows := []LedgerRow{{ID: "a", Kind: "postgres-schema", Status: "done"}, {ID: "b", Kind: "data", Status: "done", Report: []byte(`{"rowsUpdated":0}`)},
		{ID: "c", Kind: "data", Status: "not-needed"}}
	if got := notNeededVerdict(rows); got.Result != "pass" {
		t.Errorf("done over zero rows passes: %s", got.Detail)
	}
	rows = append(rows, LedgerRow{ID: "d", Kind: "data", Status: "done", Report: []byte(`{"tenants":[{"migrated":3}]}`)}, LedgerRow{ID: "e", Kind: "data", Status: "failed"})
	if got := notNeededVerdict(rows); got.Result != "fail" || !strings.Contains(got.Detail, "d touched migrated=3") || !strings.Contains(got.Detail, "e=failed") {
		t.Errorf("rows touched or a failed step fail: %s", got.Detail)
	}
}

package apidiff

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func ledgerUnion() []Operation {
	return []Operation{
		{Method: "GET", Path: "/api/prompts/{id}", InA: true, InB: true},
		{Method: "GET", Path: "/api/traces/{traceId}", InA: true, InB: true},
		{Method: "GET", Path: "/api/webhooks/v1/endpoints", InA: true, InB: true},
		{Method: "POST", Path: "/api/webhooks/v1/endpoints", InA: true, InB: true},
		{Method: "GET", Path: "/api/langy/control/state", InA: false, InB: true},
		{Method: "GET", Path: "/api/quiet", InA: true, InB: true},
	}
}

func statusFinding(kind, method, path string, before, after int) Finding {
	return Finding{Kind: kind, Method: method, Path: path, Case: "read", Fields: map[string][2]any{
		"status": {before, after},
	}}
}

func ledgerReport() Report {
	return Report{
		Findings: []Finding{
			statusFinding(FindingStatusDiff, "GET", "/api/prompts/{id}", 404, 500),
			statusFinding(FindingStatusDiff, "GET", "/api/traces/{traceId}", 404, 500),
			statusFinding(FindingStatusDiff, "GET", "/api/webhooks/v1/endpoints", 403, 503),
			statusFinding(FindingStatusDiff, "POST", "/api/webhooks/v1/endpoints", 403, 503),
			{Kind: FindingOperationMissing, Method: "GET", Path: "/api/langy/control/state", Fields: map[string][2]any{
				"presence": {"present", "absent"},
				"status":   {200, 404},
			}},
		},
		Transcripts: []Transcript{
			{Method: "GET", Path: "/api/quiet", Case: "read", A: SideResult{Status: 200}, B: SideResult{Status: 200}},
			{Method: "GET", Path: "/api/prompts/{id}", Case: "read", A: SideResult{Status: 500}, B: SideResult{Status: 404}},
		},
	}
}

func TestOperationLedgerCoversEveryUnionRow(t *testing.T) {
	union := ledgerUnion()
	ledger := BuildLedger(union, ledgerReport(), nil)
	if len(ledger.Operations) != len(union) {
		t.Fatalf("ledger has %d rows for a union of %d", len(ledger.Operations), len(union))
	}
	if ledger.Totals.UnionOperations != len(union) {
		t.Fatalf("totals.unionOperations = %d, want %d", ledger.Totals.UnionOperations, len(union))
	}
	for _, row := range ledger.Operations {
		if row.Method == "" || row.Path == "" {
			t.Fatalf("row without identity: %+v", row)
		}
	}
}

// The 14 webhook rows of the 2026-09-05 run were one regression counted 14
// times. Rows sharing a cause must collapse into one worklist item.
func TestRootCauseGroupsRowsWithOneCause(t *testing.T) {
	ledger := BuildLedger(ledgerUnion(), ledgerReport(), nil)
	byCause := map[string]LedgerCause{}
	for _, cause := range ledger.Causes {
		byCause[cause.RootCause] = cause
	}
	refusal, ok := byCause["handled-refusal-degraded:403-503"]
	if !ok {
		t.Fatalf("no handled-refusal cause in %v", byCause)
	}
	if len(refusal.Operations) != 2 || refusal.Count != 2 {
		t.Fatalf("webhook refusals = %d findings across %d operations, want 2/2", refusal.Count, len(refusal.Operations))
	}
	notFound, ok := byCause["not-found-as-500:404-500"]
	if !ok || len(notFound.Operations) != 2 {
		t.Fatalf("not-found regressions must group into one cause: %+v", notFound)
	}
	if _, ok := byCause["operation-missing-on-candidate"]; !ok {
		t.Fatalf("missing operation must have its own cause: %v", byCause)
	}
	if ledger.Totals.Causes != len(ledger.Causes) {
		t.Fatalf("totals.causes = %d, causes = %d", ledger.Totals.Causes, len(ledger.Causes))
	}
}

func TestRootCauseSlugs(t *testing.T) {
	cases := []struct {
		finding Finding
		want    string
	}{
		{statusFinding(FindingStatusDiff, "GET", "/x", 404, 500), "not-found-as-500:404-500"},
		{statusFinding(FindingStatusDiff, "GET", "/x", 403, 503), "handled-refusal-degraded:403-503"},
		{statusFinding(FindingStatusDiff, "GET", "/x", 200, 404), "route-absent-on-candidate:200-404"},
		{statusFinding(FindingStatusDiff, "GET", "/x", 500, 200), "server-error-resolved:500-200"},
		{statusFinding(FindingStatusDiff, "GET", "/x", 200, 302), "status-class-mismatch:200-302"},
		{statusFinding(FindingErrorImproved, "GET", "/x", 500, 422), "error-improved:500-422"},
		{statusFinding(FindingPermissionDiff, "GET", "/x", 403, 200), "permission-diff:403-200"},
		{Finding{Kind: FindingBodyShapeDiff, Method: "GET", Path: "/x"}, "body-shape-diff"},
		{Finding{Kind: FindingPermissionLeak, Method: "GET", Path: "/x"}, "permission-leak"},
		{Finding{Kind: FindingMutationNotVisible, Method: "GET", Path: "/x"}, "mutation-not-visible"},
		{Finding{Kind: FindingUnverifiedShape, Method: "GET", Path: "/x"}, "unverified-list-shape"},
		{Finding{Kind: FindingSkipped, Method: "GET", Path: "/x", Reason: "unresolvable parameter: id"}, "unresolvable-parameter"},
		{Finding{Kind: FindingSkipped, Method: "GET", Path: "/x", Reason: "parameter id resolvable on the base only; probing both sides would compare different requests"}, "harness-symbol-table"},
	}
	for _, testCase := range cases {
		if got := RootCause(testCase.finding); got != testCase.want {
			t.Errorf("RootCause(%s %v) = %q, want %q", testCase.finding.Kind, testCase.finding.Fields, got, testCase.want)
		}
	}
}

func TestClassificationEnumIsExhaustive(t *testing.T) {
	ledger := BuildLedger(ledgerUnion(), ledgerReport(), nil)
	allowed := map[string]bool{}
	for _, classification := range Classifications {
		allowed[classification] = true
	}
	seen := map[string]bool{}
	for _, row := range ledger.Operations {
		if !allowed[row.Classification] {
			t.Fatalf("%s %s has classification %q, outside the enum", row.Method, row.Path, row.Classification)
		}
		seen[row.Classification] = true
	}
	for _, want := range []string{ClassificationDiffers, ClassificationEqual, ClassificationMissingA} {
		if !seen[want] {
			t.Errorf("fixture must exercise %q", want)
		}
	}
}

func TestBaselineSuppressesKnownRowsOnly(t *testing.T) {
	directory := t.TempDir()
	baselinePath := filepath.Join(directory, "baseline.json")
	first := BuildLedger(ledgerUnion(), ledgerReport(), nil)
	file, err := os.Create(baselinePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteLedger(file, first); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	baseline, err := LoadCauseBaseline(baselinePath)
	if err != nil {
		t.Fatal(err)
	}
	// The same run against its own ledger: everything is known, nothing new.
	same := BuildLedger(ledgerUnion(), ledgerReport(), baseline)
	if same.Totals.NewCauses != 0 || same.Totals.KnownCauses != same.Totals.Causes {
		t.Fatalf("replayed run: %d new / %d known of %d causes, want 0 new", same.Totals.NewCauses, same.Totals.KnownCauses, same.Totals.Causes)
	}

	// One new regression on top of the baseline is the only thing reported new.
	report := ledgerReport()
	report.Findings = append(report.Findings, statusFinding(FindingStatusDiff, "GET", "/api/quiet", 200, 500))
	next := BuildLedger(ledgerUnion(), report, baseline)
	if next.Totals.NewCauses != 1 {
		t.Fatalf("newCauses = %d, want 1", next.Totals.NewCauses)
	}
	for _, cause := range next.Causes {
		if cause.RootCause == "status-class-mismatch:200-500" && cause.Known {
			t.Fatal("a cause the baseline does not name must not be known")
		}
	}
}

func TestLoadCauseBaselineAcceptsASlugArray(t *testing.T) {
	path := filepath.Join(t.TempDir(), "causes.json")
	if err := os.WriteFile(path, []byte(`["not-found-as-500:404-500","permission-leak"]`), 0o600); err != nil {
		t.Fatal(err)
	}
	baseline, err := LoadCauseBaseline(path)
	if err != nil {
		t.Fatal(err)
	}
	if !baseline["permission-leak"] || len(baseline) != 2 {
		t.Fatalf("baseline = %v", baseline)
	}
}

func TestCauseSummaryOpensWithTheCauseCount(t *testing.T) {
	ledger := BuildLedger(ledgerUnion(), ledgerReport(), nil)
	var output bytes.Buffer
	if err := WriteCauseSummary(&output, ledger); err != nil {
		t.Fatal(err)
	}
	first := strings.SplitN(output.String(), "\n", 2)[0]
	if !strings.HasPrefix(first, "root causes: ") || !strings.Contains(first, "causes across") {
		t.Fatalf("summary must open with the cause count, got %q", first)
	}
	if !strings.Contains(output.String(), "not-found-as-500:404-500") {
		t.Fatalf("summary must name each cause:\n%s", output.String())
	}
}

func moduleByFirstSegment(_, path string) string {
	switch {
	case strings.HasPrefix(path, "/api/prompts"):
		return "prompt"
	case strings.HasPrefix(path, "/api/webhooks"):
		return "webhook"
	case strings.HasPrefix(path, "/api/traces"):
		return "trace"
	}
	return ""
}

func coverageReport() Report {
	report := ledgerReport()
	report.Findings = append(report.Findings,
		Finding{Kind: FindingSkipped, Method: "GET", Path: "/api/quiet", Case: "read", Reason: "unresolvable parameter: id"},
		Finding{Kind: FindingSkipped, Method: "GET", Path: "/api/traces/{traceId}", Case: entitledCaseName,
			Reason: "parameter traceId resolvable on the candidate only; probing both sides would compare different requests"},
	)
	return report
}

func TestLedgerGroupsModuleThenCauseThenOperations(t *testing.T) {
	ledger := BuildScopedLedger(ledgerUnion(), ledgerReport(), LedgerOptions{Scope: LedgerScope{ModuleOf: moduleByFirstSegment}})
	byModule := map[string]LedgerModule{}
	for _, module := range ledger.Modules {
		byModule[module.Module] = module
	}
	webhook := byModule["webhook"]
	if webhook.Operations != 2 || len(webhook.Causes) != 1 || webhook.Causes[0].RootCause != "handled-refusal-degraded:403-503" {
		t.Fatalf("webhook module = %+v", webhook)
	}
	if len(webhook.Causes[0].Operations) != 2 || webhook.NewCauses != 1 {
		t.Fatalf("webhook cause must carry both operations and count as new: %+v", webhook.Causes[0])
	}
	notFound := byModule["prompt"].Causes
	if len(notFound) != 1 || notFound[0].Operations[0] != "GET /api/prompts/{id}" {
		t.Fatalf("a cause spanning modules must split per module: %+v", notFound)
	}
	if ledger.Modules[len(ledger.Modules)-1].Module != "" {
		t.Fatalf("the unmapped group must sort last: %+v", ledger.Modules)
	}
	if ledger.Totals.Unmapped != 2 {
		t.Fatalf("unmapped operations = %d, want 2 (langy, quiet)", ledger.Totals.Unmapped)
	}
	var output bytes.Buffer
	if err := WriteCauseSummary(&output, ledger); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "module webhook: 2 operations, 2 differing, 1 causes (1 new)") {
		t.Fatalf("summary must group by module:\n%s", output.String())
	}
}

func TestCoverageNotesAreCountedButNeverCauses(t *testing.T) {
	ledger := BuildScopedLedger(ledgerUnion(), coverageReport(), LedgerOptions{Baseline: map[string]bool{}, Scope: LedgerScope{ModuleOf: moduleByFirstSegment}})
	for _, cause := range ledger.Causes {
		if IsCoverageNote(cause.RootCause) {
			t.Fatalf("coverage note %q must not be a cause", cause.RootCause)
		}
	}
	notes := map[string]int{}
	for _, note := range ledger.CoverageNotes {
		notes[note.Note] = len(note.Operations)
	}
	if notes["unresolvable-parameter"] != 1 || notes["entitled:harness-symbol-table"] != 1 {
		t.Fatalf("coverage notes = %v", notes)
	}
	if ledger.Totals.CoverageNotes != 2 {
		t.Fatalf("totals.coverageNotes = %d, want 2", ledger.Totals.CoverageNotes)
	}
	plain := BuildLedger(ledgerUnion(), ledgerReport(), map[string]bool{})
	if ledger.Totals.NewCauses != plain.Totals.NewCauses {
		t.Fatalf("coverage notes changed the new-cause count: %d vs %d", ledger.Totals.NewCauses, plain.Totals.NewCauses)
	}
	var output bytes.Buffer
	if err := WriteCauseSummary(&output, ledger); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "coverage notes: 2 operations") {
		t.Fatalf("summary must count coverage notes in their own section:\n%s", output.String())
	}
}

func TestLedgerScopeKeepsOnlyTheScopedOperations(t *testing.T) {
	only := map[string]bool{"GET /api/webhooks/v1/endpoints": true, "POST /api/webhooks/v1/endpoints": true}
	ledger := BuildScopedLedger(ledgerUnion(), ledgerReport(), LedgerOptions{Scope: LedgerScope{Modules: []string{"webhook"}, ModuleOf: moduleByFirstSegment, Only: only}})
	if ledger.Totals.UnionOperations != 2 || len(ledger.Causes) != 1 || len(ledger.Modules) != 1 {
		t.Fatalf("scoped ledger = %+v", ledger.Totals)
	}
	if len(ledger.Scope) != 1 || ledger.Scope[0] != "webhook" {
		t.Fatalf("scope = %v", ledger.Scope)
	}
}

func TestModulePacketsCarryBothSidesEvidence(t *testing.T) {
	report := coverageReport()
	report.Transcripts = append(report.Transcripts, Transcript{
		Method: "GET", Path: "/api/webhooks/v1/endpoints", Case: "read",
		RequestPathA: "/api/webhooks/v1/endpoints", RequestPathB: "/api/webhooks/v1/endpoints",
		A: SideResult{Status: 503, Body: `{"error":"boom"}`}, B: SideResult{Status: 403, Body: `{"error":"forbidden"}`},
	})
	ledger := BuildScopedLedger(ledgerUnion(), report, LedgerOptions{Scope: LedgerScope{ModuleOf: moduleByFirstSegment}})
	dir := filepath.Join(t.TempDir(), "probe")
	written, err := WriteModulePackets(dir, ledger, report)
	if err != nil {
		t.Fatal(err)
	}
	if len(written) != 4 {
		t.Fatalf("packets = %v, want prompt, trace, webhook and unmapped", written)
	}
	data, err := os.ReadFile(filepath.Join(dir, "webhook.md"))
	if err != nil {
		t.Fatal(err)
	}
	packet := string(data)
	for _, want := range []string{"## handled-refusal-degraded:403-503 [new]", "### GET /api/webhooks/v1/endpoints", "base: GET /api/webhooks/v1/endpoints -> 403", "branch: GET /api/webhooks/v1/endpoints -> 503", "`status`: base `403`, branch `503`"} {
		if !strings.Contains(packet, want) {
			t.Fatalf("packet missing %q:\n%s", want, packet)
		}
	}
	unmapped, err := os.ReadFile(filepath.Join(dir, "unmapped.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(unmapped), "GET /api/quiet: unresolvable-parameter") {
		t.Fatalf("coverage notes belong in the packet:\n%s", unmapped)
	}
}

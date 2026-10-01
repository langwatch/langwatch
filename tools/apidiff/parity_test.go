package apidiff

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func objectInput(properties map[string]any, required ...any) map[string]any {
	return map[string]any{"type": "object", "properties": properties, "required": required}
}

func stringProperty() map[string]any { return map[string]any{"type": "string"} }

func moduleFromSource(procedure Procedure) string {
	if module := contractModule(procedure.Source); module != "" {
		return module
	}
	return unownedModule
}

func TestDiffProceduresFindsMissingBreakingAndCandidates(t *testing.T) {
	main := []Procedure{
		{Path: "traces.list", Kind: "query", Input: objectInput(map[string]any{"projectId": stringProperty()}, "projectId"), Source: "platform/app/src/server/api/routers/traces.ts"},
		{Path: "traces.getById", Kind: "query", Input: objectInput(map[string]any{"projectId": stringProperty(), "traceId": stringProperty()}, "projectId", "traceId"), Source: "main"},
		{Path: "traces.delete", Kind: "mutation", Input: objectInput(map[string]any{"projectId": stringProperty(), "limit": stringProperty()}, "projectId"), Source: "main"},
		{Path: "old.archive", Kind: "mutation", Input: objectInput(map[string]any{"datasetId": stringProperty()}, "datasetId"), Source: "main"},
	}
	branch := []Procedure{
		{Path: "traces.get", Kind: "query", Input: objectInput(map[string]any{"projectId": stringProperty(), "traceId": stringProperty()}, "projectId", "traceId"), Source: "modules/trace/contract/src/trace.trpc.ts"},
		{Path: "traces.delete", Kind: "query", Input: objectInput(map[string]any{"projectId": stringProperty(), "reason": stringProperty()}, "projectId", "reason"), Source: "modules/trace/contract/src/trace.trpc.ts"},
		{Path: "dataset.archive", Kind: "mutation", Input: objectInput(map[string]any{"datasetId": stringProperty()}, "datasetId"), Source: "modules/dataset/contract/src/dataset.trpc.ts"},
	}

	parity := DiffProcedures(main, branch, moduleFromSource)

	if parity.MainCount != 4 || parity.BranchCount != 3 || len(parity.Missing) != 3 || len(parity.Extra) != 2 {
		t.Fatalf("counts = %d/%d missing %v extra %v", parity.MainCount, parity.BranchCount, parity.Missing, parity.Extra)
	}
	if len(parity.Breaking) != 1 || parity.Breaking[0].Path != "traces.delete" || parity.Breaking[0].Module != "trace" {
		t.Fatalf("breaking = %+v", parity.Breaking)
	}
	got := map[string]bool{}
	for _, change := range parity.Breaking[0].Changes {
		got[change.Kind+" "+change.Field] = true
	}
	for _, want := range []string{"kind_changed kind", "input_property_removed input.limit", "input_property_added input.reason"} {
		if !got[want] {
			t.Errorf("missing %q in %v", want, got)
		}
	}
	if len(parity.Renamed) != 1 || parity.Renamed[0].Main != "traces.getById" || parity.Renamed[0].Branch != "traces.get" {
		t.Errorf("renamed = %+v", parity.Renamed)
	}
	if len(parity.Moved) != 1 || parity.Moved[0].Main != "old.archive" || parity.Moved[0].Branch != "dataset.archive" {
		t.Errorf("moved = %+v", parity.Moved)
	}
	for _, gap := range parity.Missing {
		if gap.Path == "old.archive" && gap.Module != "dataset" {
			t.Errorf("unowned old.archive not attributed to its move target: %+v", gap)
		}
	}

	changes := parity.TrpcChanges()
	causes := map[string]int{}
	for _, change := range changes {
		causes[SpecChangeKind(change)]++
	}
	if causes["trpc_missing"] != 3 || causes["trpc_kind_changed"] != 1 {
		t.Errorf("report kinds = %v", causes)
	}
}

func TestParityOnlyReportFeedsLedgerCauses(t *testing.T) {
	parity := TrpcParity{Missing: []ProcedureGap{{Path: "a.b", Kind: "query", Source: "x", Module: "m"}}}
	report := BuildReport(parity.TrpcChanges(), ProbeResult{})
	ledger := BuildLedger(nil, report, nil)
	if report.Differences == 0 || len(ledger.Causes) != 1 || ledger.Causes[0].RootCause != "spec-trpc-missing" {
		t.Fatalf("differences %d causes %+v", report.Differences, ledger.Causes)
	}
	known := BuildLedger(nil, report, map[string]bool{"spec-trpc-missing": true})
	if known.Totals.NewCauses != 0 {
		t.Errorf("a baselined missing procedure is still new: %+v", known.Totals)
	}
}

func TestContractModule(t *testing.T) {
	cases := map[string]string{
		"modules/trace/contract/src/trace.trpc.ts":                      "trace",
		"enterprise/modules/scim/contract/src/scim.trpc.ts":             "scim",
		"platform/app/src/server/api/routers/traces.ts":                 "",
		"enterprise/modules/governance/process/src/transport/x.trpc.ts": "",
	}
	for source, want := range cases {
		if got := contractModule(source); got != want {
			t.Errorf("contractModule(%q) = %q, want %q", source, got, want)
		}
	}
}

func TestPacketsAndTableOrderByWork(t *testing.T) {
	report := ParityReport{MainRef: "origin/main", Trpc: TrpcParity{
		MainCount: 3, BranchCount: 1,
		Missing: []ProcedureGap{{Path: "a.one", Kind: "query", Source: "r/a.ts", Module: "alpha"}, {Path: "b.one", Kind: "query", Source: "r/b.ts", Module: "beta"}, {Path: "b.two", Kind: "mutation", Source: "r/b.ts", Module: "beta"}},
		Extra:   []ProcedureGap{{Path: "a.new", Kind: "query", Source: "modules/alpha/contract/src/a.trpc.ts", Module: "alpha"}},
	}}
	report.Modules = moduleCounts(report)
	if report.Modules[0].Module != "beta" || report.Modules[0].Missing != 2 || report.Modules[1].Extra != 1 {
		t.Fatalf("modules = %+v", report.Modules)
	}
	var table strings.Builder
	if err := WriteParityTable(&table, report); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(table.String(), "tRPC main 3 / branch 1") || !strings.Contains(table.String(), "total") {
		t.Errorf("table:\n%s", table.String())
	}
	packet := renderPacket(report, "beta")
	for _, want := range []string{"# Parity packet: beta", "## Missing tRPC procedures (2)", "| `b.two` | mutation | r/b.ts |", "## REST"} {
		if !strings.Contains(packet, want) {
			t.Errorf("packet missing %q:\n%s", want, packet)
		}
	}
	if packetFileName(unownedModule) != "unowned.md" {
		t.Errorf("packet file name = %q", packetFileName(unownedModule))
	}
}

func TestRunTrpcInventoryWritesRunsAndRemovesScript(t *testing.T) {
	dir := t.TempDir()
	contractDir := filepath.Join(dir, "packages", "api", "src", "contract")
	if err := os.MkdirAll(contractDir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(contractDir, "trpc-contract.ts"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "trpc.json")
	var seen commandSpec
	fake := func(_ context.Context, spec commandSpec, _ io.Writer) error {
		seen = spec
		if _, err := os.Stat(filepath.Join(spec.dir, inventoryScriptName)); err != nil {
			t.Errorf("script not written before the run: %v", err)
		}
		return os.WriteFile(out, []byte(`{"side":"branch","procedures":[{"path":"a.b","kind":"query","source":"modules/a/contract/src/a.trpc.ts"}]}`), 0o600)
	}
	manifest, err := trpcInventory{run: fake, inherit: []string{"PATH=/bin"}, log: io.Discard}.collect(context.Background(), dir, out)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Procedures) != 1 || manifest.Procedures[0].Path != "a.b" {
		t.Errorf("manifest = %+v", manifest)
	}
	apiDir := filepath.Join(dir, "packages", "api")
	if seen.dir != apiDir || seen.name != "node" || !slices.Contains(seen.env, "SKIP_ENV_VALIDATION=1") {
		t.Errorf("spec = %+v", seen)
	}
	if _, err := os.Stat(filepath.Join(apiDir, inventoryScriptName)); !os.IsNotExist(err) {
		t.Errorf("script left behind in the worktree: %v", err)
	}
	if _, err := detectInventoryLayout(t.TempDir()); err == nil {
		t.Error("a checkout with no tRPC declarations was accepted")
	}
}

func restDocument(paths string) map[string]any {
	document, err := decodeObject([]byte(`{"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "paths": ` + paths + `}`))
	if err != nil {
		panic(err)
	}
	return document
}

func TestDiffRestPairsParameterRenamesAndClassifiesFields(t *testing.T) {
	ok := `{"200": {"description": "ok", "content": {"application/json": {"schema": {"type": "object", "properties": {"id": {"type": "string"}}}}}}}`
	base := restDocument(`{
	  "/api/things/{id}": {"get": {"operationId": "getThing", "parameters": [{"name": "id", "in": "path", "required": true}], "responses": ` + ok + `}},
	  "/api/things": {"post": {"operationId": "createThing", "responses": ` + ok + `}},
	  "/api/gone": {"get": {"operationId": "gone", "responses": ` + ok + `}}
	}`)
	candidate := restDocument(`{
	  "/api/things/{thingId}": {"get": {"operationId": "getThing", "parameters": [{"name": "thingId", "in": "path", "required": true}], "responses": ` + ok + `}},
	  "/api/things": {"post": {"operationId": "createThing", "responses": {"201": {"description": "created"}}}}
	}`)
	parity, err := DiffRest(base, candidate, func(string, string) string { return "things" })
	if err != nil {
		t.Fatal(err)
	}
	if len(parity.Missing) != 1 || parity.Missing[0].Path != "/api/gone" || len(parity.Extra) != 0 {
		t.Fatalf("missing %+v extra %+v", parity.Missing, parity.Extra)
	}
	if len(parity.Changed) != 1 || !parity.Changed[0].Breaking || parity.RestBreaking() != 1 {
		t.Fatalf("changed = %+v", parity.Changed)
	}
	if kind := SpecChangeKind(parity.Changed[0].Changes[0].Change); kind != "operation_status_removed" && kind != "operation_status_added" {
		t.Errorf("first change kind = %q", kind)
	}
}

func TestSpecDiffDropsAdditiveFieldChanges(t *testing.T) {
	base := []byte(`{"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "paths": {"/api/x": {"get": {"summary": "old", "parameters": [{"name": "a", "in": "query"}], "responses": {"200": {"description": "ok"}}}}}}`)
	candidate := []byte(`{"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "paths": {"/api/x": {"get": {"summary": "new", "parameters": [{"name": "b", "in": "query"}], "responses": {"200": {"description": "ok"}}}}}}`)
	changes, err := SpecDiff(base, candidate, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || SpecChangeKind(changes[0]) != "operation_param_removed" {
		t.Fatalf("changes = %+v, want only the removed parameter", changes)
	}
}

func TestMainOnlyNamespaceFallbacks(t *testing.T) {
	cases := []struct{ got, want string }{
		{leadingWord("governanceCost"), "governance"},
		{leadingWord("langyEgress"), "langy"},
		{leadingWord("traces"), ""},
		{enterpriseSegment("platform/app/ee/governance/routers/aiTools.ts"), "governance"},
		{enterpriseSegment("platform/app/src/server/api/routers/identityLookup.ts"), ""},
	}
	for _, testCase := range cases {
		if testCase.got != testCase.want {
			t.Errorf("got %q, want %q", testCase.got, testCase.want)
		}
	}
}

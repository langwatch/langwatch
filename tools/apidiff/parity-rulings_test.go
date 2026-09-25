package apidiff

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/openapidiff"
)

// The parity rulings of 2026-09-25: what counts as parity work, and what not.

func TestOnlyTheTracesV2MoveMatchesMain(t *testing.T) {
	input := objectInput(map[string]any{"projectId": stringProperty()}, "projectId")
	main := []Procedure{
		{Path: "tracesV2.list", Kind: "query", Input: input, Source: "platform/app/src/server/api/routers/tracesV2.ts"},
		{Path: "invite.create", Kind: "mutation", Input: input, Source: "platform/app/src/server/api/routers/invite.ts"},
	}
	branch := []Procedure{
		{Path: "traces.list", Kind: "query", Input: input, Source: "modules/trace/contract/src/trace.trpc.ts"},
		{Path: "organization.create", Kind: "mutation", Input: input, Source: "modules/organization/contract/src/organization.trpc.ts"},
	}
	parity := DiffProcedures(main, branch, moduleFromSource)
	if len(parity.Missing) != 1 || parity.Missing[0].Path != "invite.create" {
		t.Fatalf("missing = %+v, want only invite.create", parity.Missing)
	}
	if len(parity.Extra) != 1 || parity.Extra[0].Path != "organization.create" {
		t.Errorf("extra = %+v, want traces.list matched to main's tracesV2.list", parity.Extra)
	}
	if len(parity.Moved) != 1 || parity.Moved[0].Main != "invite.create" {
		t.Errorf("moved = %+v, want invite.create still a candidate only", parity.Moved)
	}
}

func TestTracesV2MoveStillComparesTheInput(t *testing.T) {
	main := []Procedure{{Path: "tracesV2.get", Kind: "query", Input: objectInput(map[string]any{"traceId": stringProperty()}, "traceId"), Source: "main"}}
	branch := []Procedure{{Path: "traces.get", Kind: "query", Input: objectInput(map[string]any{}), Source: "modules/trace/contract/src/trace.trpc.ts"}}
	parity := DiffProcedures(main, branch, moduleFromSource)
	if len(parity.Breaking) != 1 || parity.Breaking[0].Path != "tracesV2.get" || parity.Breaking[0].Module != "trace" {
		t.Fatalf("breaking = %+v", parity.Breaking)
	}
}

func TestAnInputMainLeftOpenIsNeverBreaking(t *testing.T) {
	main := []Procedure{{Path: "workflow.autosave", Kind: "mutation", Source: "main", Input: objectInput(map[string]any{
		"dsl": objectInput(map[string]any{"nodes": map[string]any{"type": "array"}}, "nodes"),
	}, "dsl")}}
	nodes := map[string]any{"type": "array", "items": objectInput(map[string]any{"id": stringProperty()}, "id")}
	branch := []Procedure{{Path: "workflow.autosave", Kind: "mutation", Source: "modules/workflow/contract/src/workflow.trpc.ts", Input: objectInput(map[string]any{
		"dsl": objectInput(map[string]any{"nodes": nodes}, "nodes"),
	}, "dsl")}}
	if parity := DiffProcedures(main, branch, moduleFromSource); len(parity.Breaking) != 0 {
		t.Errorf("breaking = %+v, want nothing under main's itemless array", parity.Breaking)
	}
}

func TestExactCatalogueNameOutranksThePrefixDeclaration(t *testing.T) {
	repoRoot := t.TempDir()
	files := map[string]string{
		"modules/" + moduleCatalogFile: `{"version":0,"features":[
			{"id":"user","root":"modules/user","subjects":["user"]},
			{"id":"identity","root":"modules/identity","subjects":["identity"]}]}`,
		"modules/user/contract/src/user.trpc.ts": `defineTrpcContract("user")
defineTrpcContract("identity")`,
	}
	for name, body := range files {
		path := filepath.Join(repoRoot, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	phase := &parityPhase{state: &bootState{branchDir: repoRoot}, modules: map[string]string{}}
	cases := map[string]string{
		"identityLookup.resolve":      "identity",
		"user.me":                     "user",
		"twoStepVerification.account": "",
	}
	for path, want := range cases {
		source := "platform/app/src/server/api/routers/" + strings.Split(path, ".")[0] + ".ts"
		got := phase.procedureModule(Procedure{Path: path, Source: source})
		if want == "" {
			want = unownedModule
		}
		if got != want {
			t.Errorf("procedureModule(%s) = %q, want %q", path, got, want)
		}
	}
}

func restOperation(responses, requestSchema string) string {
	return `{"post": {"operationId": "op", "requestBody": {"content": {"application/json": {"schema": ` + requestSchema + `}}}, "responses": ` + responses + `}}`
}

func TestStatusAndAdditiveBodyDiffsAreNoCause(t *testing.T) {
	ok := `"200": {"description": "ok", "content": {"application/json": {"schema": {"type": "object", "required": ["id"], "properties": {"id": {"type": "string"}}}}}}`
	okWider := `"200": {"description": "ok", "content": {"application/json": {"schema": {"type": "object", "required": ["id"], "properties": {"id": {"type": "string"}, "extra": {"type": "string"}}}}}}`
	body := `{"type": "object", "properties": {"name": {"type": "string"}}}`
	wider := `{"type": "object", "properties": {"name": {"type": "string"}, "tag": {"type": "string"}}}`
	base := []byte(`{"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "paths": {"/api/x": ` + restOperation(`{`+ok+`, "401": {"description": "no"}, "500": {"description": "no"}}`, body) + `}}`)
	candidate := []byte(`{"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "paths": {"/api/x": ` + restOperation(`{`+okWider+`, "422": {"description": "no"}}`, wider) + `}}`)
	changes, err := SpecDiff(base, candidate, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ledger := BuildLedger(nil, BuildReport(changes, ProbeResult{}), nil)
	if len(changes) != 0 || len(ledger.Causes) != 0 {
		t.Fatalf("changes %+v causes %+v, want none", changes, ledger.Causes)
	}
}

func TestUndocumentedRequestBodyIsOneCausePerOperation(t *testing.T) {
	ok := `{"200": {"description": "ok"}}`
	base := []byte(`{"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "paths": {"/api/x": ` + restOperation(ok, `{"type": "object", "properties": {"a": {"type": "string"}, "b": {"type": "string"}, "c": {"type": "string"}}}`) + `}}`)
	candidate := []byte(`{"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "paths": {"/api/x": ` + restOperation(ok, `{}`) + `}}`)
	changes, err := SpecDiff(base, candidate, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || SpecChangeKind(changes[0]) != "operation_request_body_undocumented" {
		t.Fatalf("changes = %+v, want one request_body_undocumented", changes)
	}
}

func TestPacketsCountStatusDiffsWithoutListingThem(t *testing.T) {
	status := ClassifiedChange{Change: openapidiff.Change{Kind: "status_removed", Fields: map[string][2]any{"401": {nil, nil}}}, Class: openapidiff.ClassNotCompared}
	gone := ClassifiedChange{Change: openapidiff.Change{Kind: "response_property_removed", Fields: map[string][2]any{"200.id": {nil, nil}}}, Class: openapidiff.ClassBreaking}
	rest := RestParity{Changed: []RestDiff{
		{Method: "GET", Path: "/api/a", Module: "m", Changes: []ClassifiedChange{status}},
		{Method: "GET", Path: "/api/b", Module: "m", Breaking: true, Changes: []ClassifiedChange{status, gone}},
	}}
	var output strings.Builder
	writeRestSections(&output, rest, "m")
	packet := output.String()
	if strings.Contains(packet, "status_removed") || strings.Contains(packet, "/api/a") {
		t.Errorf("packet lists a status difference:\n%s", packet)
	}
	for _, want := range []string{"response_property_removed 200.id", "Documented error statuses differ on 2 operations"} {
		if !strings.Contains(packet, want) {
			t.Errorf("packet missing %q:\n%s", want, packet)
		}
	}
}

func TestARuledProcedureMoveMatchesItsNewPath(t *testing.T) {
	input := objectInput(map[string]any{"sessionId": stringProperty()}, "sessionId")
	main := []Procedure{{Path: "tracesV2.codingAgentSession", Kind: "query", Input: input, Source: "main"}}
	branch := []Procedure{{Path: "codingAgents.session", Kind: "query", Input: input, Source: "modules/coding-agent/contract/src/coding-agent.trpc.ts"}}
	parity := DiffProcedures(main, branch, moduleFromSource)
	if len(parity.Missing) != 0 || len(parity.Extra) != 0 {
		t.Fatalf("missing = %+v, extra = %+v, want codingAgents.session matched", parity.Missing, parity.Extra)
	}
}

func TestARetiredProcedureIsNotMissing(t *testing.T) {
	main := []Procedure{{Path: "publicEnv", Kind: "query", Source: "platform/app/src/server/api/routers/publicEnv.ts"}}
	parity := DiffProcedures(main, nil, moduleFromSource)
	if len(parity.Missing) != 0 {
		t.Fatalf("missing = %+v, want publicEnv retired", parity.Missing)
	}
	if len(parity.Retired) != 1 || parity.Retired[0].Path != "publicEnv" {
		t.Errorf("retired = %+v, want publicEnv", parity.Retired)
	}
}

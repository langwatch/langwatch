package apidiff

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/langwatch/langwatch/tools/openapidiff"
)

func pairingDocument(security, paths string) []byte {
	return []byte(`{"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "security": ` + security + `, "paths": ` + paths + `}`)
}

func pathParam(name string) string {
	return `{"name": "` + name + `", "in": "path", "required": true, "schema": {"type": "string"}}`
}

func pairingOperation(security, parameter, body string) string {
	return `{"operationId": "op", "security": ` + security + `, "parameters": [` + parameter + `],
	  "requestBody": {"required": ` + body + `, "content": {"application/json": {"schema": {"type": "object"}}}},
	  "responses": {"200": {"description": "ok"}}}`
}

func diffKinds(t *testing.T, base, candidate []byte) []string {
	t.Helper()
	changes, err := SpecDiff(base, candidate, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	kinds := make([]string, 0, len(changes))
	for _, change := range changes {
		kinds = append(kinds, change.Method+" "+change.Path+" "+SpecChangeKind(change))
	}
	return kinds
}

// @scenario "A parameter rename is one operation in the spec diff"
func TestSpecDiffPairsAParameterRenameWithIdenticalSecurity(t *testing.T) {
	t.Parallel()
	security := `[{"apiKey": []}]`
	base := pairingDocument(security, `{"/api/teams/{id}/members/{userId}": {"delete": `+pairingOperation(security, pathParam("id")+`, `+pathParam("userId"), "false")+`}}`)
	candidate := pairingDocument(security, `{"/api/teams/{teamId}/members/{memberId}": {"delete": `+pairingOperation(security, pathParam("teamId")+`, `+pathParam("memberId"), "false")+`}}`)

	if kinds := diffKinds(t, base, candidate); len(kinds) != 0 {
		t.Fatalf("changes = %v, want none for a pure rename", kinds)
	}
}

// A paired operation is compared, so a real change on it still shows, under
// the candidate's spelling the ledger rows use.
// @scenario "A parameter rename is one operation in the spec diff"
func TestSpecDiffStillReportsARealChangeOnAPairedOperation(t *testing.T) {
	t.Parallel()
	security := `[{"apiKey": []}]`
	base := pairingDocument(security, `{"/api/triggers/{id}": {"patch": `+pairingOperation(security, pathParam("id"), "false")+`}}`)
	candidate := pairingDocument(security, `{"/api/triggers/{triggerId}": {"patch": `+pairingOperation(security, pathParam("triggerId"), "true")+`}}`)

	kinds := diffKinds(t, base, candidate)
	want := []string{"patch /api/triggers/{triggerId} operation_request_body_required_changed"}
	if !slices.Equal(kinds, want) {
		t.Fatalf("changes = %v, want %v", kinds, want)
	}
}

// @scenario "A pair whose security differs is not paired"
func TestSpecDiffDoesNotPairOperationsWithDifferentSecurity(t *testing.T) {
	t.Parallel()
	base := pairingDocument(`[]`, `{"/api/groups/{id}": {"get": `+pairingOperation(`[{"apiKey": []}]`, pathParam("id"), "false")+`}}`)
	candidate := pairingDocument(`[]`, `{"/api/groups/{groupId}": {"get": `+pairingOperation(`[]`, pathParam("groupId"), "false")+`}}`)

	kinds := diffKinds(t, base, candidate)
	want := []string{"get /api/groups/{groupId} operation_added", "get /api/groups/{id} operation_removed"}
	slices.Sort(kinds)
	slices.Sort(want)
	if !slices.Equal(kinds, want) {
		t.Fatalf("changes = %v, want %v (a security difference keeps the pair split)", kinds, want)
	}
}

func TestSpecDiffSecurityInheritedFromTheDocumentCountsAsSecurity(t *testing.T) {
	t.Parallel()
	own := `{"operationId": "op", "security": [{"apiKey": []}], "parameters": [` + pathParam("id") + `], "responses": {"200": {"description": "ok"}}}`
	inherited := `{"operationId": "op", "parameters": [` + pathParam("groupId") + `], "responses": {"200": {"description": "ok"}}}`
	base := pairingDocument(`[]`, `{"/api/groups/{id}": {"get": `+own+`}}`)
	candidate := pairingDocument(`[]`, `{"/api/groups/{groupId}": {"get": `+inherited+`}}`)

	if kinds := diffKinds(t, base, candidate); len(kinds) != 2 {
		t.Fatalf("changes = %v, want the removal and the addition kept apart", kinds)
	}
}

func TestSpecDiffPairsOnlyTheMethodsBothSidesDocument(t *testing.T) {
	t.Parallel()
	security := `[{"apiKey": []}]`
	get := pairingOperation(security, pathParam("id"), "false")
	base := pairingDocument(security, `{"/api/things/{id}": {"get": `+get+`, "delete": `+get+`}}`)
	candidateGet := pairingOperation(security, pathParam("thingId"), "false")
	candidate := pairingDocument(security, `{"/api/things/{thingId}": {"get": `+candidateGet+`}}`)

	kinds := diffKinds(t, base, candidate)
	want := []string{"delete /api/things/{id} operation_removed"}
	if !slices.Equal(kinds, want) {
		t.Fatalf("changes = %v, want %v (a method the candidate lacks is still missing)", kinds, want)
	}
}

func TestSpecDiffDoesNotPairPathsThatDifferInALiteralOrArity(t *testing.T) {
	t.Parallel()
	security := `[{"apiKey": []}]`
	op := func(parameter string) string { return pairingOperation(security, parameter, "false") }
	base := pairingDocument(security, `{"/api/things/{id}/runs": {"get": `+op(pathParam("id"))+`}}`)
	candidate := pairingDocument(security, `{"/api/things/{id}/jobs": {"get": `+op(pathParam("id"))+`}}`)

	if kinds := diffKinds(t, base, candidate); len(kinds) != 2 {
		t.Fatalf("changes = %v, want a removal and an addition", kinds)
	}
}

func TestSpecDiffRefusesAnAmbiguousPartner(t *testing.T) {
	t.Parallel()
	security := `[{"apiKey": []}]`
	op := func(parameter string) string { return pairingOperation(security, parameter, "false") }
	base := pairingDocument(security, `{"/api/things/{id}": {"get": `+op(pathParam("id"))+`}}`)
	candidate := pairingDocument(security, `{"/api/things/{a}": {"get": `+op(pathParam("a"))+`}, "/api/things/{b}": {"get": `+op(pathParam("b"))+`}}`)

	if kinds := diffKinds(t, base, candidate); len(kinds) != 3 {
		t.Fatalf("changes = %v, want one removal and two additions", kinds)
	}
}

func TestSpecDiffPairsAReferencedPathParameter(t *testing.T) {
	t.Parallel()
	security := `[{"apiKey": []}]`
	referenced := `{"operationId": "op", "parameters": [{"$ref": "#/components/parameters/Id"}], "responses": {"200": {"description": "ok"}}}`
	base := []byte(`{"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "security": ` + security + `,
	  "components": {"parameters": {"Id": ` + pathParam("id") + `}},
	  "paths": {"/api/things/{id}": {"get": ` + referenced + `}, "/api/others/{id}": {"get": ` + referenced + `}}}`)
	candidate := []byte(`{"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "security": ` + security + `,
	  "components": {"parameters": {"Id": ` + pathParam("id") + `, "ThingId": ` + pathParam("thingId") + `}},
	  "paths": {"/api/things/{thingId}": {"get": {"operationId": "op", "parameters": [{"$ref": "#/components/parameters/ThingId"}], "responses": {"200": {"description": "ok"}}}},
	    "/api/others/{id}": {"get": ` + referenced + `}}}`)

	if kinds := diffKinds(t, base, candidate); len(kinds) != 0 {
		t.Fatalf("changes = %v, want none", kinds)
	}
}

// @scenario "A ruling covers only the spec changes it was given for"
func TestRuledSpecChangeCoversOnlyTheKindsItWasGivenFor(t *testing.T) {
	t.Parallel()
	cases := []struct {
		method, path, kind string
		ruled              bool
	}{
		{"GET", "/api/trace/{id}", "operation_response_type_changed", true},
		{"GET", "/api/trace/{traceId}", "operation_response_property_removed", true},
		{"GET", "/api/trace/{id}", "operation_security_changed", false},
		{"GET", "/api/trace/{id}", "operation_param_removed", false},
		{"GET", "/api/agents/connect/poll", "operation_response_required_changed", true},
		{"GET", "/api/agents/connect/poll", "operation_security_changed", false},
		{"POST", "/api/agents/connect/register", "operation_request_body_required_changed", true},
		{"GET", "/api/checkup", "operation_response_required_changed", true},
		{"GET", "/api/checkup", "operation_response_type_changed", false},
		{"GET", "/api/unruled", "operation_response_type_changed", false},
		{"GET", "/api/trace/{id}", "component_changed", false},
	}
	for _, testCase := range cases {
		if got := ruledSpecChange(testCase.method, testCase.path, testCase.kind) != ""; got != testCase.ruled {
			t.Errorf("%s %s %s: ruled = %v, want %v", testCase.method, testCase.path, testCase.kind, got, testCase.ruled)
		}
	}

	security := openapidiff.Change{Kind: "security_changed", Method: "get", Path: "/api/trace/{id}", Fields: map[string][2]any{"security": {nil, nil}}}
	if report := BuildReport([]openapidiff.Change{security}, ProbeResult{}); report.Differences != 1 {
		t.Errorf("a security change on a phantom-ruled operation: differences = %d, want 1", report.Differences)
	}
}

func TestRuledSpecChangesAreNotCountedAsDifferencesOrCauses(t *testing.T) {
	t.Parallel()
	ruled := openapidiff.Change{Kind: "response_type_changed", Method: "get", Path: "/api/trace/{id}", Fields: map[string][2]any{"200.x": {"integer", "number"}}}
	unruled := openapidiff.Change{Kind: "response_type_changed", Method: "get", Path: "/api/other/{id}", Fields: map[string][2]any{"200.x": {"integer", "number"}}}
	report := BuildReport([]openapidiff.Change{ruled, unruled}, ProbeResult{})

	if report.Differences != 1 {
		t.Errorf("differences = %d, want 1 (the unruled change only)", report.Differences)
	}
	if report.SpecChanges[0].Ruling == "" || report.SpecChanges[1].Ruling != "" {
		t.Errorf("rulings = %q / %q, want the first ruled and the second not", report.SpecChanges[0].Ruling, report.SpecChanges[1].Ruling)
	}
	ledger := BuildLedger(nil, report, nil)
	if len(ledger.Causes) != 1 || !strings.Contains(ledger.Causes[0].Operations[0], "/api/other/{id}") {
		t.Fatalf("causes = %+v, want one cause on the unruled operation", ledger.Causes)
	}
}

func TestACatalogueReadIsNotAPermissionLeak(t *testing.T) {
	t.Parallel()
	for _, read := range []string{"GET /api/checkup", "GET /api/query/reference"} {
		if !catalogReads[read] {
			t.Errorf("%s is not a catalogue read", read)
		}
	}
	if catalogReads["GET /api/query/schema"] {
		t.Error("GET /api/query/schema must stay a judged read: it answers a database name, not a catalogue id")
	}
}

// A documented JSON body with no schema is sent as {} under its media type,
// so a handler that insists on the header is judged, not the missing header.
// @scenario "A documented JSON body without a schema is sent as JSON"
func TestAnEmptyJSONBodySchemaIsSentWithItsContentType(t *testing.T) {
	t.Parallel()
	for name, media := range map[string]string{"no schema": `{}`, "empty schema": `{"schema": {}}`} {
		document := mustSpec(t, `{"openapi": "3.1.0", "paths": {"/api/auth/cli/exchange": {"post": {
		  "requestBody": {"required": true, "content": {"application/json": `+media+`}}, "responses": {"200": {"description": "ok"}}}}}}`)
		operations, err := Operations(document)
		if err != nil || len(operations) != 1 {
			t.Fatalf("%s: operations = %v, %v", name, operations, err)
		}
		cases := operationCases(operations[0])
		if len(cases) != 1 || cases[0].name != "mutation" || cases[0].body == nil {
			t.Fatalf("%s: cases = %+v, want one mutation carrying a body", name, cases)
		}

		var mu sync.Mutex
		var contentType, received string
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			contentType = request.Header.Get("Content-Type")
			buffer := make([]byte, 16)
			count, _ := request.Body.Read(buffer)
			received = string(buffer[:count])
		}))
		engine := &probeEngine{ctx: context.Background(), client: server.Client()}
		engine.execute(probeRequest{baseURL: server.URL, method: "POST", path: "/api/auth/cli/exchange", body: cases[0].body})
		server.Close()
		if contentType != "application/json" || received != "{}" {
			t.Errorf("%s: sent Content-Type %q body %q, want application/json and {}", name, contentType, received)
		}
	}
}

func TestAnUndocumentedBodyStaysUnsent(t *testing.T) {
	t.Parallel()
	for name, body := range map[string]string{
		"no requestBody":    ``,
		"another media":     `"requestBody": {"content": {"application/x-ndjson": {}}},`,
		"no content at all": `"requestBody": {"required": false},`,
	} {
		document := mustSpec(t, `{"openapi": "3.1.0", "paths": {"/api/x": {"post": {`+body+` "responses": {"200": {"description": "ok"}}}}}}`)
		operations, err := Operations(document)
		if err != nil || len(operations) != 1 {
			t.Fatalf("%s: operations = %v, %v", name, operations, err)
		}
		if cases := operationCases(operations[0]); len(cases) != 1 || cases[0].body != nil {
			t.Errorf("%s: cases = %+v, want one case with no body", name, cases)
		}
	}
}

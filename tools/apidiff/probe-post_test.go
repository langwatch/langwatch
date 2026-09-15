package apidiff

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCollectionMatches(t *testing.T) {
	cases := []struct {
		get, post string
		want      bool
	}{
		{"/api/widgets", "/api/widgets", true},
		{"/api/widgets", "/api/widgets/{id}", true},
		{"/api/annotations", "/api/annotations/trace/{id}", true},
		{"/api/widgets/{id}", "/api/widgets", false},
		{"/api/widgets", "/api/other", false},
		{"/api/wid", "/api/widgets", false}, // segment boundary, not string prefix
	}
	for _, testCase := range cases {
		if got := collectionMatches(testCase.get, testCase.post); got != testCase.want {
			t.Errorf("collectionMatches(%q, %q) = %v, want %v", testCase.get, testCase.post, got, testCase.want)
		}
	}
}

func TestEmptyListBody(t *testing.T) {
	if !emptyListBody(`[]`) {
		t.Error("top-level empty array must be an empty list")
	}
	if !emptyListBody(`{"data": [], "total": 0}`) {
		t.Error("wrapped empty array must be an empty list")
	}
	if emptyListBody(`{"data": [{"id": "x"}]}`) {
		t.Error("non-empty array must not be an empty list")
	}
	if emptyListBody(`{"name": "x"}`) {
		t.Error("object without arrays is not a list")
	}
	if emptyListBody(`not json`) {
		t.Error("non-JSON is not an empty list")
	}
}

func TestContainsString(t *testing.T) {
	body := `{"data": [{"nested": {"id": "needle"}}]}`
	decoded, _ := decodeJSONBody(body)
	if !containsString(decoded, "needle") {
		t.Error("must find nested string")
	}
	if containsString(decoded, "haystack") {
		t.Error("must not find absent string")
	}
	if containsString(decoded, "need") {
		t.Error("exact match only")
	}
}

// widgetsSpec documents a create + list pair secured by the project key.
const widgetsSpec = `{
  "openapi": "3.0.3",
  "paths": {
    "/api/widgets": {
      "get": {"operationId": "listWidgets", "responses": {"200": {"description": "ok"}}},
      "post": {
        "operationId": "createWidget",
        "requestBody": {"required": true, "content": {"application/json": {"schema": {
          "type": "object", "required": ["name"], "properties": {"name": {"type": "string"}}
        }}}},
        "responses": {"200": {"description": "ok"}}
      }
    }
  },
  "components": {"securitySchemes": {"project_api_key": {"type": "apiKey", "in": "header", "name": "X-Auth-Token"}}},
  "security": [{"project_api_key": []}]
}`

// widgetsServer serves the widgets collection with controllable list
// contents and per-key behavior for the permission probes.
func widgetsServer(t *testing.T, listBody, createID string, foreignKeyStatus int) *httptest.Server {
	t.Helper()
	return newTestServer(t, widgetsSpec, map[string]http.HandlerFunc{
		"GET /api/widgets": func(writer http.ResponseWriter, request *http.Request) {
			if request.Header.Get("X-Auth-Token") != DefaultProjectKey {
				writeJSON(writer, foreignKeyStatus, `{"error": "denied"}`)
				return
			}
			writeJSON(writer, 200, listBody)
		},
		"POST /api/widgets": func(writer http.ResponseWriter, request *http.Request) {
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body["name"] == nil {
				writeJSON(writer, 400, `{"error": "validation"}`)
				return
			}
			writeJSON(writer, 200, `{"id": "`+createID+`", "name": "apidiff"}`)
		},
	})
}

func TestCollectionVerificationVisible(t *testing.T) {
	// Both sides list the entity their own mutation created: the collection
	// pass compares the non-empty lists and finds nothing.
	sideA := widgetsServer(t, `[{"id": "w-a", "name": "apidiff"}]`, "w-a", 403)
	sideB := widgetsServer(t, `[{"id": "w-b", "name": "apidiff"}]`, "w-b", 403)
	code, stdout, _ := runProbeCLI(t, "probe", "-a", sideA.URL, "-b", sideB.URL,
		"-project-key-b", ProjectKeyB, "-project-key-c", ProjectKeyC)
	if code != 0 {
		t.Fatalf("exit = %d, want 0:\n%s", code, stdout)
	}
	if strings.Contains(stdout, "mutation_not_visible") || strings.Contains(stdout, "unverified_shape") {
		t.Fatalf("covered, visible list must not be flagged:\n%s", stdout)
	}
}

func TestCollectionVerificationNotVisible(t *testing.T) {
	// Side B's list does not contain the entity its mutation created.
	sideA := widgetsServer(t, `[{"id": "w-a", "name": "apidiff"}]`, "w-a", 403)
	sideB := widgetsServer(t, `[]`, "w-b", 403)
	// A short settle: the wait exists for a projection that has not run yet,
	// and here the entity is never coming.
	code, stdout, _ := runProbeCLI(t, "probe", "-a", sideA.URL, "-b", sideB.URL, "-settle-timeout", "200ms")
	if code != 1 {
		t.Fatalf("exit = %d, want 1:\n%s", code, stdout)
	}
	if !strings.Contains(stdout, "mutation_not_visible") {
		t.Fatalf("want mutation_not_visible finding:\n%s", stdout)
	}
	if !strings.Contains(stdout, `"visible":[false,true]`) {
		t.Fatalf("visibility fields must show base missing the entity:\n%s", stdout)
	}
}

func TestUnverifiedEmptyList(t *testing.T) {
	// No create operation covers this collection: empty on both sides is a
	// coverage note, not a difference.
	spec := `{
	  "openapi": "3.0.3",
	  "paths": {
	    "/api/widgets": {"get": {"operationId": "listWidgets", "responses": {"200": {"description": "ok"}}}}
	  }
	}`
	routes := map[string]http.HandlerFunc{
		"GET /api/widgets": func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, 200, `[]`)
		},
	}
	code, stdout, _ := runProbeCLI(t, "probe", "-a", newTestServer(t, spec, routes).URL, "-b", newTestServer(t, spec, routes).URL)
	if code != 0 {
		t.Fatalf("exit = %d, want 0 (unverified is not a difference):\n%s", code, stdout)
	}
	if !strings.Contains(stdout, "unverified_shape") || !strings.Contains(stdout, "item shape not exercised") {
		t.Fatalf("want unverified_shape note:\n%s", stdout)
	}
	if !strings.Contains(stdout, "unverified: 1 list endpoints") {
		t.Fatalf("want unverified totals line:\n%s", stdout)
	}
}

func TestPermissionLeakDetection(t *testing.T) {
	// Side A answers the foreign key with 200 AND the owning project's data —
	// a leak. Side B denies.
	spec := widgetsSpec
	sideACreated := []string{}
	sideA := newTestServer(t, spec, map[string]http.HandlerFunc{
		"GET /api/widgets": func(writer http.ResponseWriter, request *http.Request) {
			if request.Header.Get("X-Auth-Token") == DefaultProjectKey {
				writeJSON(writer, 200, `[{"id": "w-a", "name": "apidiff"}]`)
				return
			}
			// Leak: foreign key gets the owner's data.
			writeJSON(writer, 200, `[{"id": "w-a", "name": "apidiff"}]`)
		},
		"POST /api/widgets": func(writer http.ResponseWriter, request *http.Request) {
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body["name"] == nil {
				writeJSON(writer, 400, `{"error": "validation"}`)
				return
			}
			sideACreated = append(sideACreated, "w-a")
			writeJSON(writer, 200, `{"id": "w-a", "name": "apidiff"}`)
		},
	})
	sideB := widgetsServer(t, `[{"id": "w-b", "name": "apidiff"}]`, "w-b", 403)

	code, stdout, _ := runProbeCLI(t, "probe", "-a", sideA.URL, "-b", sideB.URL,
		"-project-key-b", ProjectKeyB, "-project-key-c", ProjectKeyC)
	if code != 1 {
		t.Fatalf("exit = %d, want 1:\n%s", code, stdout)
	}
	if !strings.Contains(stdout, "permission_leak") {
		t.Fatalf("want permission_leak finding:\n%s", stdout)
	}
	if !strings.Contains(stdout, `"key":["key-b","key-b"]`) {
		t.Fatalf("leak must name the key:\n%s", stdout)
	}
}

func TestPermissionDiffWithoutLeak(t *testing.T) {
	// Foreign key gets 200 with NO owned data on A (empty list), 403 on B:
	// denial classes disagree without a data leak.
	sideA := widgetsServer(t, `[]`, "w-a", 200)
	sideB := widgetsServer(t, `[]`, "w-b", 403)
	// The empty list means the foreign 200 leaks nothing, but the classes
	// still disagree.
	code, stdout, _ := runProbeCLI(t, "probe", "-a", sideA.URL, "-b", sideB.URL,
		"-project-key-b", ProjectKeyB, "-project-key-c", ProjectKeyC)
	if code != 1 {
		t.Fatalf("exit = %d, want 1:\n%s", code, stdout)
	}
	if !strings.Contains(stdout, "permission_diff") {
		t.Fatalf("want permission_diff finding:\n%s", stdout)
	}
	if strings.Contains(stdout, "permission_leak") {
		t.Fatalf("no data leaked, must not be a leak:\n%s", stdout)
	}
}

func TestPermissionProbesSkippedWithoutKeys(t *testing.T) {
	// Probe mode without the extra keys: no permission cases at all.
	sideA := widgetsServer(t, `[]`, "w-a", 200)
	sideB := widgetsServer(t, `[]`, "w-b", 403)
	code, stdout, _ := runProbeCLI(t, "probe", "-a", sideA.URL, "-b", sideB.URL)
	if code != 0 {
		t.Fatalf("exit = %d, want 0:\n%s", code, stdout)
	}
	if strings.Contains(stdout, "permission") {
		t.Fatalf("no permission probes without -project-key-b/-c:\n%s", stdout)
	}
}

// The permission probe used to rebuild the OWNER's full header set and
// overwrite only X-Auth-Token, so a multi-scheme operation kept the owner's
// bearer, succeeded legitimately, and was reported as a leak.
func TestPermissionProbeDropsOwnerBearer(t *testing.T) {
	schemes := map[string]map[string]any{
		"project_api_key": {"type": "apiKey", "in": "header", "name": "X-Auth-Token"},
		"admin_api_key":   {"type": "http", "scheme": "bearer"},
	}
	multiScheme := Operation{Method: "GET", Path: "/api/things", Security: []string{"project_api_key", "admin_api_key"}}
	if headers, ok := foreignProjectHeaders(multiScheme, schemes, ProjectKeyC); ok {
		t.Fatalf("a multi-scheme operation must be skipped, got headers %v", headers)
	}

	projectOnly := Operation{Method: "GET", Path: "/api/things", Security: []string{"project_api_key"}}
	headers, ok := foreignProjectHeaders(projectOnly, schemes, ProjectKeyC)
	if !ok {
		t.Fatal("a project-key operation must be probed")
	}
	if headers["X-Auth-Token"] != ProjectKeyC {
		t.Fatalf("headers = %v, want only the foreign project key", headers)
	}
	if _, present := headers["Authorization"]; present {
		t.Fatalf("no owner credential may survive: %v", headers)
	}
	if len(headers) != 1 {
		t.Fatalf("headers = %v, want exactly one", headers)
	}
}

// A foreign key reading its OWN project, organization or team is the shared
// and cascading scope working, not a leak.
func TestForeignKeyOwnScopeIsNotALeak(t *testing.T) {
	owner := map[string]bool{"local-dev-project": true, fixtureProjectCID: true}
	body := SideResult{Status: 200, Body: `{"projectId": "` + fixtureProjectCID + `"}`}
	scope := map[string]bool{fixtureProjectCID: true, fixtureOrg2ID: true, fixtureTeam2ID: true}
	if id, ok := leakedID(owner, body, scope); ok {
		t.Fatalf("own-scope id %q reported as a leak", id)
	}
	leaking := SideResult{Status: 200, Body: `{"projectId": "local-dev-project"}`}
	id, ok := leakedID(owner, leaking, scope)
	if !ok || id != "local-dev-project" {
		t.Fatalf("leak = %q, %v; want the owner's project id named", id, ok)
	}
	denied := SideResult{Status: 403, Body: `{"projectId": "local-dev-project"}`}
	if _, ok := leakedID(owner, denied, scope); ok {
		t.Fatal("a denial cannot leak")
	}
}

// A leak nobody can adjudicate from the report is a puzzle: the finding
// records which id matched.
func TestPermissionLeakFindingNamesTheMatchedID(t *testing.T) {
	engine := &probeEngine{
		options:  ProbeOptions{Keys: Keys{ProjectKeyB: ProjectKeyB, ProjectKeyC: ProjectKeyC}},
		ownerIDs: map[string]*sideIDs{},
	}
	operation := Operation{Method: "GET", Path: "/api/widgets"}
	owner := newSideIDs()
	owner.a["w-a"] = true
	owner.b["w-b"] = true
	engine.ownerIDs[operationKeyOf(operation)] = owner

	transcript := Transcript{
		Method: "GET", Path: "/api/widgets", Case: "permission-key-c",
		A: SideResult{Status: 200, Body: `[{"id": "w-a"}]`},
		B: SideResult{Status: 403, Body: `{"error": "denied"}`},
	}
	findings := engine.classifyPermission(operation, engine.foreignKeys()[1], transcript)
	if len(findings) != 1 || findings[0].Kind != FindingPermissionLeak {
		t.Fatalf("findings = %+v, want one permission_leak", findings)
	}
	if got := findings[0].Fields["id"]; got[1] != "w-a" {
		t.Fatalf("finding must name the matched id, got %v", got)
	}
}

// The settle is event-driven: a list that only shows the entity on a later
// read is a wait, not a mutation_not_visible finding.
func TestSettleWaitsForACollectionToCatchUp(t *testing.T) {
	sideA := lateListServer(t, "w-a", 0)
	sideB := lateListServer(t, "w-b", 2)
	code, stdout, _ := runProbeCLI(t, "probe", "-a", sideA.URL, "-b", sideB.URL, "-settle-timeout", "5s")
	if strings.Contains(stdout, "mutation_not_visible") {
		t.Fatalf("a list that catches up must not be reported as invisible:\n%s", stdout)
	}
	if code != 0 {
		t.Fatalf("exit = %d, want 0:\n%s", code, stdout)
	}
}

// A list that never catches up is a finding, and it says what was waited for.
func TestSettleGivesUpAndNamesWhatItWaitedFor(t *testing.T) {
	sideA := lateListServer(t, "w-a", 0)
	sideB := lateListServer(t, "w-b", 100)
	code, stdout, _ := runProbeCLI(t, "probe", "-a", sideA.URL, "-b", sideB.URL, "-settle-timeout", "1s")
	if code != 1 {
		t.Fatalf("exit = %d, want 1:\n%s", code, stdout)
	}
	if !strings.Contains(stdout, "mutation_not_visible") {
		t.Fatalf("want mutation_not_visible:\n%s", stdout)
	}
	if !strings.Contains(stdout, "waited") || !strings.Contains(stdout, "appear in both lists") {
		t.Fatalf("the finding must name what was waited for:\n%s", stdout)
	}
}

// lateListServer lists what its own POST created, but withholds it for the
// first withheldReads reads after the create — a projection that has not run
// yet.
func lateListServer(t *testing.T, mintedID string, withheldReads int) *httptest.Server {
	t.Helper()
	created := false
	reads := 0
	return newTestServer(t, widgetsSpec, map[string]http.HandlerFunc{
		"GET /api/widgets": func(writer http.ResponseWriter, request *http.Request) {
			if request.Header.Get("X-Auth-Token") != DefaultProjectKey {
				writeJSON(writer, 403, `{"error": "denied"}`)
				return
			}
			if !created {
				writeJSON(writer, 200, `[]`)
				return
			}
			reads++
			if reads <= withheldReads {
				writeJSON(writer, 200, `[]`)
				return
			}
			writeJSON(writer, 200, `[{"id": "`+mintedID+`", "name": "apidiff"}]`)
		},
		"POST /api/widgets": func(writer http.ResponseWriter, request *http.Request) {
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body["name"] == nil {
				writeJSON(writer, 400, `{"error": "validation"}`)
				return
			}
			created = true
			writeJSON(writer, 200, `{"id": "`+mintedID+`", "name": "apidiff"}`)
		},
	})
}

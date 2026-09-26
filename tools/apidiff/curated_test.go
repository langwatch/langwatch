package apidiff

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func keysOf(operations []Operation) []string {
	keys := make([]string, 0, len(operations))
	for index := range operations {
		keys = append(keys, operationKeyOf(operations[index]))
	}
	return keys
}

func TestProbeOrderRunsCuratedCreatesFirstAndDeletesLast(t *testing.T) {
	operations := []Operation{
		{Method: http.MethodDelete, Path: "/api/agents/{id}"},
		{Method: http.MethodGet, Path: "/api/agents/{id}"},
		{Method: http.MethodPost, Path: "/api/agents"},
		{Method: http.MethodPost, Path: "/api/monitors"},
		{Method: http.MethodGet, Path: "/api/monitors"},
		{Method: http.MethodPost, Path: "/api/evaluators"},
	}
	got := strings.Join(keysOf(probeOrder(operations)), ", ")
	want := "POST /api/evaluators, POST /api/monitors, POST /api/agents, GET /api/agents/{id}, GET /api/monitors, DELETE /api/agents/{id}"
	if got != want {
		t.Fatalf("order:\n got %s\nwant %s", got, want)
	}
}

func TestFillTemplateUsesEachSidesOwnIDs(t *testing.T) {
	symbolsA, symbolsB := NewSymbolTable(), NewSymbolTable()
	symbolsA.file("agentid", "agent-a")
	symbolsB.file("agentid", "agent-b")
	create := curatedCreate{key: "POST /api/x", body: map[string]any{
		"targets": []any{map[string]any{"referenceId": "{{agentid}}"}},
		"project": "{{const:projectid}}",
	}}
	bodyA, bodyB, missing := curatedBodies(create, symbolsA, symbolsB)
	if missing != "" {
		t.Fatalf("unexpected missing: %s", missing)
	}
	encodedA, _ := json.Marshal(bodyA)
	encodedB, _ := json.Marshal(bodyB)
	if string(encodedA) != `{"project":"local-dev-project","targets":[{"referenceId":"agent-a"}]}` {
		t.Fatalf("candidate body = %s", encodedA)
	}
	if string(encodedB) != `{"project":"local-dev-project","targets":[{"referenceId":"agent-b"}]}` {
		t.Fatalf("base body = %s", encodedB)
	}
}

func TestFillTemplateNamesTheMissingPrerequisiteAndSide(t *testing.T) {
	symbolsA, symbolsB := NewSymbolTable(), NewSymbolTable()
	symbolsA.file("scenarioid", "scenario-a")
	create := curatedCreate{key: "POST /api/suites", body: map[string]any{"scenarioIds": []any{"{{scenarioid}}"}}}
	_, _, missing := curatedBodies(create, symbolsA, symbolsB)
	if !strings.Contains(missing, "needs scenarioid") || !strings.Contains(missing, "on the base") {
		t.Fatalf("missing = %q, want the placeholder and the side named", missing)
	}
}

func TestErrorEnvelopeIDsAreNeverCaptured(t *testing.T) {
	symbols := NewSymbolTable()
	captureSucceeded(symbols, "/api/experiments/runs", SideResult{Status: 404, Body: `{"code":"not_found","trace_id":"abc","meta":{"id":"runs"}}`})
	if _, ok := symbols.latest("traceid"); ok {
		t.Fatal("an error envelope's trace_id must not become a trace id")
	}
	if _, ok := symbols.latest("experimentid"); ok {
		t.Fatal("an error envelope's meta.id must not become an experiment id")
	}
	captureSucceeded(symbols, "/api/experiments", SideResult{Status: 201, Body: `{"id":"exp-1"}`})
	if got, _ := symbols.latest("experimentid"); got != "exp-1" {
		t.Fatalf("experimentid = %q, want exp-1", got)
	}
}

func TestUserBoundOperationsPresentThePersonalToken(t *testing.T) {
	keys := Keys{ProjectKey: "project-key", OrgKey: "personal-token"}
	headers := userBoundHeaders(Operation{Path: "/api/model-defaults/{id}"}, map[string]string{"X-Auth-Token": "project-key"}, keys)
	if headers["Authorization"] != "Bearer personal-token" || headers["X-Project-Id"] != seededProjectID || headers["X-Auth-Token"] != "" {
		t.Fatalf("headers = %v", headers)
	}
	untouched := userBoundHeaders(Operation{Path: "/api/prompts"}, map[string]string{"X-Auth-Token": "project-key"}, keys)
	if untouched["X-Auth-Token"] != "project-key" {
		t.Fatalf("a project route must keep its project key: %v", untouched)
	}
}

const suiteSpec = `{
  "openapi": "3.0.3",
  "paths": {
    "/api/agents": {"post": {"operationId": "createAgent",
      "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object"}}}},
      "responses": {"201": {"description": "ok"}}}},
    "/api/scenarios": {"post": {"operationId": "createScenario",
      "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object"}}}},
      "responses": {"201": {"description": "ok"}}}},
    "/api/suites": {"post": {"operationId": "createSuite",
      "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object"}}}},
      "responses": {"201": {"description": "ok"}}}}
  }
}`

// suiteServer mints its own agent and scenario ids and records every suite
// body it is sent.
func suiteServer(t *testing.T, suffix string, suiteBodies *[]string) *httptest.Server {
	t.Helper()
	return newTestServer(t, suiteSpec, map[string]http.HandlerFunc{
		"POST /api/agents": func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, 201, `{"id": "agent-`+suffix+`"}`)
		},
		"POST /api/scenarios": func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, 201, `{"id": "scenario-`+suffix+`"}`)
		},
		"POST /api/suites": func(writer http.ResponseWriter, request *http.Request) {
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body["targets"] == nil {
				writeJSON(writer, 422, `{"error": "validation"}`)
				return
			}
			encoded, _ := json.Marshal(body)
			*suiteBodies = append(*suiteBodies, string(encoded))
			writeJSON(writer, 201, `{"id": "suite-`+suffix+`"}`)
		},
	})
}

func TestCuratedCreateSendsEachSideItsOwnPrerequisites(t *testing.T) {
	var bodiesA, bodiesB []string
	sideA := suiteServer(t, "a", &bodiesA)
	sideB := suiteServer(t, "b", &bodiesB)

	code, stdout, _ := runProbeCLI(t, "probe", "-a", sideA.URL, "-b", sideB.URL, "-settle-timeout", "200ms")
	if code != 0 {
		t.Fatalf("exit = %d, want 0:\n%s", code, stdout)
	}
	if len(bodiesA) != 1 || len(bodiesB) != 1 {
		t.Fatalf("each side must be sent exactly one valid suite: A=%v B=%v", bodiesA, bodiesB)
	}
	if !strings.Contains(bodiesA[0], `"agent-a"`) || !strings.Contains(bodiesA[0], `"scenario-a"`) {
		t.Fatalf("candidate suite body = %s", bodiesA[0])
	}
	if !strings.Contains(bodiesB[0], `"agent-b"`) || !strings.Contains(bodiesB[0], `"scenario-b"`) {
		t.Fatalf("base suite body = %s", bodiesB[0])
	}
}

func TestCuratedCreateIDOutranksALaterListCapture(t *testing.T) {
	symbols := NewSymbolTable()
	pinCreated(symbols, "/api/model-defaults", SideResult{Status: 200, Body: `{"id":"model_default_created"}`})
	captureSucceeded(symbols, "/api/model-defaults", SideResult{Status: 200, Body: `{"configs":[{"id":"local-dev-organization"}]}`})
	if got, _ := symbols.Lookup("id", "/api/model-defaults/{id}"); got != "model_default_created" {
		t.Fatalf("id = %q, want the curated create's own id", got)
	}
}

func TestUnresolvableReasonNamesWhyNothingMintsIt(t *testing.T) {
	if got := unresolvableReason("turnId", "/api/internal/langy/turn/{turnId}/result"); !strings.Contains(got, "langy agent service") {
		t.Fatalf("reason = %q", got)
	}
	if got := unresolvableReason("id", "/api/webhooks/v1/events/{id}"); !strings.Contains(got, "AI gateway") {
		t.Fatalf("reason = %q", got)
	}
	if got := unresolvableReason("fooId", "/api/foo/{fooId}"); !strings.Contains(got, "no earlier create") {
		t.Fatalf("reason = %q", got)
	}
}

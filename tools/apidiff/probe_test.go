package apidiff

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestServer serves a canned OpenAPI spec plus routes whose behavior the
// test controls per side.
func newTestServer(t *testing.T, spec string, routes map[string]http.HandlerFunc) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc(SpecPath, func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		io_WriteString(writer, spec)
	})
	for pattern, handler := range routes {
		mux.HandleFunc(pattern, handler)
	}
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func io_WriteString(writer http.ResponseWriter, text string) {
	if _, err := writer.Write([]byte(text)); err != nil {
		panic(err)
	}
}

func writeJSON(writer http.ResponseWriter, status int, body string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	io_WriteString(writer, body)
}

// baseSpec is served by both sides; the candidate adds /api/extra.
const probeBaseSpec = `{
  "openapi": "3.0.3",
  "paths": {
    "/api/things": {
      "get": {"operationId": "listThings", "responses": {"200": {"description": "ok"}}},
      "post": {
        "operationId": "createThing",
        "requestBody": {"required": true, "content": {"application/json": {"schema": {
          "type": "object", "required": ["name"], "properties": {"name": {"type": "string"}}
        }}}},
        "responses": {"200": {"description": "ok"}, "400": {"description": "bad"}}
      }
    }
  }
}`

const probeCandidateSpec = `{
  "openapi": "3.0.3",
  "paths": {
    "/api/things": {
      "get": {"operationId": "listThings", "responses": {"200": {"description": "ok"}}},
      "post": {
        "operationId": "createThing",
        "requestBody": {"required": true, "content": {"application/json": {"schema": {
          "type": "object", "required": ["name"], "properties": {"name": {"type": "string"}}
        }}}},
        "responses": {"200": {"description": "ok"}, "400": {"description": "bad"}}
      }
    },
    "/api/extra": {
      "get": {"operationId": "getExtra", "responses": {"200": {"description": "ok"}}}
    }
  }
}`

// differingRoutes reproduce controlled differences: the base side answers
// the mutation with 201 and a different validation envelope.
func candidateRoutes() map[string]http.HandlerFunc {
	return map[string]http.HandlerFunc{
		"GET /api/things": func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, 200, `{"things": [{"id": "a1", "created_at": "2026-01-01T00:00:00Z", "name": "x"}]}`)
		},
		"POST /api/things": func(writer http.ResponseWriter, request *http.Request) {
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body["name"] == nil {
				writeJSON(writer, 400, `{"error": "validation", "message": "name is required"}`)
				return
			}
			writeJSON(writer, 200, `{"id": "new-1", "name": "apidiff"}`)
		},
		"GET /api/extra": func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, 200, `{"extra": true}`)
		},
	}
}

func baseRoutes() map[string]http.HandlerFunc {
	return map[string]http.HandlerFunc{
		"GET /api/things": func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, 200, `{"things": [{"id": "b9", "created_at": "2026-03-03T00:00:00Z", "name": "x"}]}`)
		},
		"POST /api/things": func(writer http.ResponseWriter, request *http.Request) {
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body["name"] == nil {
				writeJSON(writer, 422, `{"error": "validation", "fields": {"name": ["required"]}}`)
				return
			}
			writeJSON(writer, 201, `{"id": "new-2", "name": "apidiff"}`)
		},
	}
}

func runProbeCLI(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := Run(args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func TestProbeReportsControlledDifferences(t *testing.T) {
	candidate := newTestServer(t, probeCandidateSpec, candidateRoutes())
	base := newTestServer(t, probeBaseSpec, baseRoutes())

	code, stdout, _ := runProbeCLI(t, "probe", "-a", candidate.URL, "-b", base.URL)
	if code != 1 {
		t.Fatalf("exit = %d, want 1; stdout:\n%s", code, stdout)
	}

	var report Report
	if err := json.Unmarshal([]byte(mustJSONReport(t, candidate, base)), &report); err != nil {
		t.Fatalf("json report: %v", err)
	}

	kinds := map[string]int{}
	for _, finding := range report.Findings {
		kinds[finding.Kind]++
	}
	// The missing operation on the base side.
	if kinds[FindingOperationMissing] != 1 {
		t.Errorf("operation_missing = %d, want 1 (findings: %v)", kinds[FindingOperationMissing], report.Findings)
	}
	// The mutation status difference (200 vs 201) and the validation case
	// (400 vs 422) are same-class: suppressed by default, not findings.
	if kinds[FindingStatusDiff] != 0 {
		t.Errorf("status_diff = %d, want 0 (same-class suppressed)", kinds[FindingStatusDiff])
	}
	if kinds[FindingErrorShapeDiff] != 0 {
		t.Errorf("error_shape_diff = %d, want 0 (error bodies skipped)", kinds[FindingErrorShapeDiff])
	}
	if report.Suppressed.SameClassStatus != 2 || report.Suppressed.ErrorBody != 1 {
		t.Errorf("suppressed = %+v, want 2 same-class + 1 error-body", report.Suppressed)
	}
	// The masked GET responses must NOT diff despite different ids/timestamps.
	if kinds[FindingBodyValueDiff] != 0 || kinds[FindingBodyShapeDiff] != 0 {
		t.Errorf("read case must not diff: %v", report.Findings)
	}
	// The spec diff found the added operation.
	if len(report.SpecChanges) != 1 || report.SpecChanges[0].Kind != "operation_added" {
		t.Errorf("spec changes = %+v, want one operation_added", report.SpecChanges)
	}

	for _, want := range []string{
		"spec changes:", "findings:", "differences across 3 operations probed",
		"suppressed: 2 same-class status differences, 1 error-body comparisons",
	} {
		if !strings.Contains(stdout, want) {
			t.Errorf("stdout missing %q:\n%s", want, stdout)
		}
	}
}

func mustJSONReport(t *testing.T, candidate, base *httptest.Server) string {
	t.Helper()
	code, stdout, _ := runProbeCLI(t, "probe", "-a", candidate.URL, "-b", base.URL, "-json")
	if code != 1 {
		t.Fatalf("json probe exit = %d, want 1", code)
	}
	return stdout
}

func TestProbeEqualInstancesExitZero(t *testing.T) {
	candidate := newTestServer(t, probeBaseSpec, candidateRoutes())
	base := newTestServer(t, probeBaseSpec, map[string]http.HandlerFunc{
		"GET /api/things": func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, 200, `{"things": [{"id": "zz", "created_at": "2026-09-09T09:09:09Z", "name": "x"}]}`)
		},
		"POST /api/things": func(writer http.ResponseWriter, request *http.Request) {
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body["name"] == nil {
				writeJSON(writer, 400, `{"error": "validation", "message": "name is required"}`)
				return
			}
			writeJSON(writer, 200, `{"id": "other", "name": "apidiff"}`)
		},
	})
	code, stdout, _ := runProbeCLI(t, "probe", "-a", candidate.URL, "-b", base.URL)
	if code != 0 {
		t.Fatalf("exit = %d, want 0; stdout:\n%s", code, stdout)
	}
	if !strings.Contains(stdout, "no behavioral differences across 2 operations probed") {
		t.Fatalf("stdout missing zero-diff line:\n%s", stdout)
	}
}

func TestSchemeHeaderClassification(t *testing.T) {
	keys := Keys{ProjectKey: "proj", OrgKey: "org", AdminKey: "admin", ScimKey: "scim"}
	cases := []struct {
		name       string
		scheme     map[string]any
		wantHeader string
		wantValue  string
	}{
		{"project_api_key", map[string]any{"type": "apiKey", "in": "header", "name": "X-Auth-Token"}, "X-Auth-Token", "proj"},
		{"admin_api_key", map[string]any{"type": "http", "scheme": "bearer"}, "Authorization", "Bearer org"},
		{"instance_admin_key", map[string]any{"type": "http", "scheme": "bearer"}, "Authorization", "Bearer admin"},
		{"scim_bearer", map[string]any{"type": "http", "scheme": "bearer"}, "Authorization", "Bearer scim"},
		{"unknown", nil, "X-Auth-Token", "proj"},
	}
	for _, testCase := range cases {
		cred := schemeHeader(testCase.name, testCase.scheme, keys)
		if cred.header != testCase.wantHeader || cred.value != testCase.wantValue {
			t.Errorf("schemeHeader(%q) = %+v; want %s: %s", testCase.name, cred, testCase.wantHeader, testCase.wantValue)
		}
	}
	// Missing keys never skip: the credential is simply absent.
	empty := Keys{}
	for _, gated := range []string{"instance_admin_key", "scim_bearer"} {
		if cred := schemeHeader(gated, map[string]any{"type": "http", "scheme": "bearer"}, empty); cred.header != "" {
			t.Errorf("schemeHeader(%q) without key = %+v, want no credential", gated, cred)
		}
	}
}

// TestProbeAdminSchemesWithoutKey: instance-admin operations are probed even
// without a key — unauthenticated — and identical outcomes produce nothing.
func TestProbeAdminSchemesWithoutKey(t *testing.T) {
	spec := `{
	  "openapi": "3.0.3",
	  "paths": {
	    "/api/admin/thing": {
	      "get": {"operationId": "adminThing", "security": [{"instanceAdmin": []}], "responses": {"200": {"description": "ok"}}}
	    }
	  },
	  "components": {"securitySchemes": {"instanceAdmin": {"type": "apiKey", "in": "header", "name": "X-Admin-Key"}}}
	}`
	server := newTestServer(t, spec, nil)
	code, stdout, _ := runProbeCLI(t, "probe", "-a", server.URL, "-b", server.URL)
	if code != 0 {
		t.Fatalf("exit = %d, want 0", code)
	}
	if strings.Contains(stdout, "skipped") {
		t.Fatalf("no skips without a key — the operation is probed unauthenticated:\n%s", stdout)
	}
	if !strings.Contains(stdout, "no behavioral differences across 1 operations probed") {
		t.Fatalf("stdout:\n%s", stdout)
	}
}

func TestProbeAliasFormsCollapse(t *testing.T) {
	// Side A documents /api/v1/widgets, side B documents /api/widgets: one
	// operation, each side probed at its own documented form.
	specA := `{
	  "openapi": "3.0.3",
	  "paths": {
	    "/api/v1/widgets": {"get": {"operationId": "listWidgets", "responses": {"200": {"description": "ok"}}}},
	    "/api/otel/v1/traces": {"get": {"operationId": "otelTraces", "responses": {"200": {"description": "ok"}}}}
	  }
	}`
	specB := `{
	  "openapi": "3.0.3",
	  "paths": {
	    "/api/widgets": {"get": {"operationId": "listWidgets", "responses": {"200": {"description": "ok"}}}},
	    "/api/otel/v1/traces": {"get": {"operationId": "otelTraces", "responses": {"200": {"description": "ok"}}}}
	  }
	}`
	gotA := []string{}
	serverA := newTestServer(t, specA, map[string]http.HandlerFunc{
		"GET /api/v1/widgets": func(writer http.ResponseWriter, r *http.Request) {
			gotA = append(gotA, r.URL.Path)
			writeJSON(writer, 200, `{"widgets": []}`)
		},
		"GET /api/otel/v1/traces": func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, 200, `{"traces": []}`)
		},
	})
	gotB := []string{}
	serverB := newTestServer(t, specB, map[string]http.HandlerFunc{
		"GET /api/widgets": func(writer http.ResponseWriter, r *http.Request) {
			gotB = append(gotB, r.URL.Path)
			writeJSON(writer, 200, `{"widgets": []}`)
		},
		"GET /api/otel/v1/traces": func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, 200, `{"traces": []}`)
		},
	})

	code, stdout, _ := runProbeCLI(t, "probe", "-a", serverA.URL, "-b", serverB.URL)
	if code != 0 {
		t.Fatalf("exit = %d, want 0 (alias forms are the same operation):\n%s", code, stdout)
	}
	if len(gotA) != 1 || gotA[0] != "/api/v1/widgets" {
		t.Fatalf("side A probed at %v, want its documented /api/v1 form", gotA)
	}
	if len(gotB) != 1 || gotB[0] != "/api/widgets" {
		t.Fatalf("side B probed at %v, want its documented bare form", gotB)
	}
	if strings.Contains(stdout, "operation_missing") {
		t.Fatalf("alias collapse must not produce operation_missing:\n%s", stdout)
	}
	if !strings.Contains(stdout, "no behavioral differences across 2 operations probed") {
		t.Fatalf("stdout:\n%s", stdout)
	}
}

func TestShouldRetry5xx(t *testing.T) {
	cases := []struct {
		method string
		result SideResult
		want   bool
	}{
		{"GET", SideResult{Status: 500}, true},
		{"GET", SideResult{Status: 503}, true},
		{"HEAD", SideResult{Status: 502}, true},
		{"OPTIONS", SideResult{Status: 500}, true},
		{"POST", SideResult{Status: 500}, false},   // mutations never retry
		{"DELETE", SideResult{Status: 500}, false}, // mutations never retry
		{"GET", SideResult{Status: 404}, false},
		{"GET", SideResult{Status: 200}, false},
		{"GET", SideResult{Error: "connection refused"}, false}, // transport errors fail fast
	}
	for _, testCase := range cases {
		if got := shouldRetry5xx(testCase.method, testCase.result); got != testCase.want {
			t.Errorf("shouldRetry5xx(%s, %+v) = %v, want %v", testCase.method, testCase.result, got, testCase.want)
		}
	}
}

// TestProbeRetriesTransient5xx: a GET that 500s twice then recovers produces
// no finding — a momentary infrastructure flap must not become a diff.
func TestProbeRetriesTransient5xx(t *testing.T) {
	spec := `{
	  "openapi": "3.0.3",
	  "paths": {
	    "/api/things": {"get": {"operationId": "listThings", "responses": {"200": {"description": "ok"}}}}
	  }
	}`
	flaky := 0
	flakyRoutes := map[string]http.HandlerFunc{
		"GET /api/things": func(writer http.ResponseWriter, _ *http.Request) {
			flaky++
			if flaky <= 2 {
				writeJSON(writer, 500, `{"error": "the database system is in recovery mode"}`)
				return
			}
			writeJSON(writer, 200, `{"things": []}`)
		},
	}
	stableRoutes := map[string]http.HandlerFunc{
		"GET /api/things": func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, 200, `{"things": []}`)
		},
	}
	candidate := newTestServer(t, spec, flakyRoutes)
	base := newTestServer(t, spec, stableRoutes)

	code, stdout, stderr := runProbeCLI(t, "probe", "-a", candidate.URL, "-b", base.URL)
	if code != 0 {
		t.Fatalf("exit = %d, want 0 after retry recovery:\n%s", code, stdout)
	}
	if flaky != 3 {
		t.Fatalf("flaky side called %d times, want 3 (2 retries)", flaky)
	}
	if !strings.Contains(stderr, "retry GET /api/things after 500") {
		t.Fatalf("stderr must log retries:\n%s", stderr)
	}
}

func TestProbeExcludePrefixAndMethodFilter(t *testing.T) {
	spec := `{
	  "openapi": "3.0.3",
	  "paths": {
	    "/api/gateway/v1/chat": {"post": {"operationId": "chat", "responses": {"200": {"description": "ok"}}}},
	    "/api/things": {"get": {"operationId": "list", "responses": {"200": {"description": "ok"}}}}
	  }
	}`
	called := false
	server := newTestServer(t, spec, map[string]http.HandlerFunc{
		"GET /api/things": func(writer http.ResponseWriter, _ *http.Request) {
			called = true
			writeJSON(writer, 200, `{}`)
		},
	})
	// The default exclude prefix covers /api/gateway without a route.
	code, _, _ := runProbeCLI(t, "probe", "-a", server.URL, "-b", server.URL)
	if code != 0 || !called {
		t.Fatalf("exit = %d, things called = %v; want 0/true", code, called)
	}
	code, _, stderr := runProbeCLI(t, "probe", "-a", server.URL, "-b", server.URL, "-method", "delete")
	if code != 0 || !strings.Contains(stderr, "probing 0 operations") {
		t.Fatalf("method filter: exit = %d, stderr:\n%s", code, stderr)
	}
}

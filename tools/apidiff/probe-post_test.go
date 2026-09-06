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
	code, stdout, _ := runProbeCLI(t, "probe", "-a", sideA.URL, "-b", sideB.URL)
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

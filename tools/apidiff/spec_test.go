package apidiff

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/langwatch/langwatch/tools/openapidiff"
)

func openapiChange(method, kind string) openapidiff.Change {
	return openapidiff.Change{Kind: kind, Method: method}
}

func mustSpec(t *testing.T, doc string) map[string]any {
	t.Helper()
	parsed, err := decodeObject([]byte(doc))
	if err != nil {
		t.Fatalf("decode spec fixture: %v", err)
	}
	return parsed
}

const specFixture = `{
  "openapi": "3.0.3",
  "security": [{"projectKey": []}],
  "paths": {
    "/api/things": {
      "parameters": [{"name": "tenant", "in": "query", "required": true, "schema": {"type": "string", "default": "local"}}],
      "get": {"operationId": "listThings", "responses": {"200": {"description": "ok"}}},
      "post": {
        "operationId": "createThing",
        "requestBody": {"required": true, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Thing"}}}},
        "responses": {"200": {"description": "ok"}}
      }
    },
    "/api/things/{id}": {
      "get": {
        "operationId": "getThing",
        "security": [{"orgBearer": []}],
        "parameters": [{"name": "id", "in": "path", "required": true, "schema": {"type": "string"}}],
        "responses": {"200": {"description": "ok"}}
      }
    }
  },
  "components": {
    "schemas": {
      "Thing": {"type": "object", "required": ["name"], "properties": {
        "name": {"type": "string"},
        "parent": {"$ref": "#/components/schemas/Thing"}
      }}
    },
    "securitySchemes": {
      "projectKey": {"type": "apiKey", "in": "header", "name": "X-Auth-Token"},
      "orgBearer": {"type": "http", "scheme": "bearer"}
    }
  }
}`

func TestOperationsParse(t *testing.T) {
	operations, err := Operations(mustSpec(t, specFixture))
	if err != nil {
		t.Fatal(err)
	}
	if len(operations) != 3 {
		t.Fatalf("got %d operations, want 3", len(operations))
	}
	// Sorted by path, then method.
	if operations[0].Path != "/api/things" || operations[0].Method != http.MethodGet ||
		operations[1].Path != "/api/things" || operations[1].Method != http.MethodPost ||
		operations[2].Path != "/api/things/{id}" {
		t.Fatalf("unexpected order: %v", operations)
	}

	post := operations[1]
	if post.OperationID != "createThing" || !post.BodyRequired {
		t.Fatalf("post = %+v", post)
	}
	// The body schema $ref is resolved; the recursive parent ref is left as-is.
	if post.BodySchema["type"] != "object" {
		t.Fatalf("body schema not resolved: %v", post.BodySchema)
	}
	properties := post.BodySchema["properties"].(map[string]any)
	if _, ok := properties["parent"].(map[string]any)["$ref"]; !ok {
		t.Fatalf("cycle must leave $ref in place: %v", properties["parent"])
	}
	// Path-item parameters merge into operations.
	if len(post.Params) != 1 || post.Params[0].Name != "tenant" {
		t.Fatalf("merged params = %+v", post.Params)
	}
	if !post.Params[0].HasValue || post.Params[0].Example != "local" {
		t.Fatalf("schema default must become the example: %+v", post.Params[0])
	}
	// Root security applies unless the operation overrides it.
	if len(post.Security) != 1 || post.Security[0] != "projectKey" {
		t.Fatalf("post security = %v", post.Security)
	}
	getThing := operations[2]
	if len(getThing.Security) != 1 || getThing.Security[0] != "orgBearer" {
		t.Fatalf("operation security override = %v", getThing.Security)
	}
}

func TestUnionOperations(t *testing.T) {
	a := mustSpec(t, specFixture)
	b := mustSpec(t, specFixture)
	// B lacks the POST; A lacks nothing.
	bPaths := b["paths"].(map[string]any)
	things := bPaths["/api/things"].(map[string]any)
	delete(things, "post")

	opsA, err := Operations(a)
	if err != nil {
		t.Fatal(err)
	}
	opsB, err := Operations(b)
	if err != nil {
		t.Fatal(err)
	}
	union := UnionOperations(opsA, opsB)
	if len(union) != 3 {
		t.Fatalf("union has %d operations, want 3", len(union))
	}
	var post *Operation
	for index := range union {
		if union[index].Method == http.MethodPost {
			post = &union[index]
		}
		if !union[index].InA || !union[index].InB {
			if union[index].Method != http.MethodPost {
				t.Fatalf("unexpected missing side: %+v", union[index])
			}
		}
	}
	if post == nil || !post.InA || post.InB {
		t.Fatalf("post presence = %+v, want A only", post)
	}
}

func TestCanonicalAliasPath(t *testing.T) {
	cases := []struct{ in, want string }{
		{"/api/v1/projects", "/api/projects"},
		{"/api/v1/projects/{id}", "/api/projects/{id}"},
		{"/api/projects", "/api/projects"},
		{"/api/otel/v1/traces", "/api/otel/v1/traces"},
		{"/api/scim/v2/Users", "/api/scim/v2/Users"},
		{"/api/gateway/v1/chat", "/api/gateway/v1/chat"},
		{"/api/v1/v2/experiments", "/api/v1/v2/experiments"}, // rest opens with a version segment
		{"/api/v10/projects", "/api/v10/projects"},           // only v1 is the auto-alias
	}
	for _, testCase := range cases {
		if got := CanonicalAliasPath(testCase.in); got != testCase.want {
			t.Errorf("CanonicalAliasPath(%q) = %q, want %q", testCase.in, got, testCase.want)
		}
	}
}

func TestUnionOperationsAliasForms(t *testing.T) {
	a := []Operation{{Method: http.MethodGet, Path: "/api/v1/widgets"}}
	b := []Operation{{Method: http.MethodGet, Path: "/api/widgets"}}
	union := UnionOperations(a, b)
	if len(union) != 1 {
		t.Fatalf("union = %d operations, want 1", len(union))
	}
	operation := union[0]
	if operation.Path != "/api/widgets" || !operation.InA || !operation.InB {
		t.Fatalf("merged operation = %+v", operation)
	}
	if operation.PathA != "/api/v1/widgets" || operation.PathB != "/api/widgets" {
		t.Fatalf("forms = %+v", operation)
	}
	sideA, sideB := operation.SidePaths()
	if sideA != "/api/v1/widgets" || sideB != "/api/widgets" {
		t.Fatalf("side paths = %q, %q", sideA, sideB)
	}

	// A side that documents neither alias form is probed at the canonical one.
	oneSided := UnionOperations(nil, b)
	if len(oneSided) != 1 || oneSided[0].InA || !oneSided[0].InB {
		t.Fatalf("one-sided = %+v", oneSided)
	}
	sideA, _ = oneSided[0].SidePaths()
	if sideA != "/api/widgets" {
		t.Fatalf("absent side probes canonical form, got %q", sideA)
	}
}

func TestSecuritySchemesUnion(t *testing.T) {
	schemes := SecuritySchemes(mustSpec(t, specFixture))
	if len(schemes) != 2 || schemes["projectKey"]["name"] != "X-Auth-Token" {
		t.Fatalf("schemes = %v", schemes)
	}
}

func TestSpecChangeKind(t *testing.T) {
	cases := []struct {
		method, changeKind, want string
	}{
		{"get", "added", "operation_added"},
		{"delete", "removed", "operation_removed"},
		{"post", "changed", "operation_changed"},
		{"component", "changed", "component_changed"},
		{"<path-item>", "changed", "path_item_changed"},
	}
	for _, testCase := range cases {
		got := SpecChangeKind(openapiChange(testCase.method, testCase.changeKind))
		if got != testCase.want {
			t.Errorf("SpecChangeKind(%s, %s) = %q, want %q", testCase.method, testCase.changeKind, got, testCase.want)
		}
	}
}

func TestSpecDiffFindsChanges(t *testing.T) {
	dir := t.TempDir()
	other := mustSpec(t, specFixture)
	otherPaths := other["paths"].(map[string]any)
	otherPaths["/api/extra"] = map[string]any{
		"get": map[string]any{"operationId": "extra", "responses": map[string]any{"200": map[string]any{"description": "ok"}}},
	}
	otherBytes, err := json.Marshal(other)
	if err != nil {
		t.Fatal(err)
	}
	changes, err := SpecDiff([]byte(specFixture), otherBytes, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || changes[0].Kind != "added" || changes[0].Path != "/api/extra" {
		t.Fatalf("changes = %+v, want one added /api/extra", changes)
	}
}

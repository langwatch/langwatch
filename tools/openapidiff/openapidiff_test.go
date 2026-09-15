package openapidiff

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeDoc(t *testing.T, value map[string]any) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "openapi.json")
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, b, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func d(p, s map[string]any) map[string]any {
	return map[string]any{"openapi": "3.1.0", "paths": p, "components": map[string]any{"schemas": s}}
}
func op(id string) map[string]any {
	return map[string]any{"operationId": id, "responses": map[string]any{"200": map[string]any{"description": "ok"}}}
}
func TestOrderingAndOperations(t *testing.T) {
	a := d(map[string]any{"/x": map[string]any{"get": op("x")}}, nil)
	b := d(map[string]any{"/x": map[string]any{"get": map[string]any{"responses": map[string]any{"200": map[string]any{"description": "ok"}}, "operationId": "x"}}}, nil)
	r, e := Diff(a, b, "", "")
	if e != nil || len(r) != 0 {
		t.Fatalf("%v %#v", e, r)
	}
}
func TestOperationFieldsAndComponents(t *testing.T) {
	old := op("o")
	old["responses"].(map[string]any)["200"].(map[string]any)["content"] = map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/S"}}}
	a := d(map[string]any{"/old": map[string]any{"get": op("o")}, "/x": map[string]any{"post": old}}, map[string]any{"S": map[string]any{"type": "string"}})
	x := op("n")
	x["security"] = []any{map[string]any{"k": []any{}}}
	x["responses"].(map[string]any)["200"].(map[string]any)["content"] = map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/S"}}}
	b := d(map[string]any{"/new": map[string]any{"get": op("n")}, "/x": map[string]any{"post": x}}, map[string]any{"S": map[string]any{"type": "object"}})
	r, _ := Diff(a, b, "", "")
	if len(r) != 4 {
		t.Fatalf("%#v", r)
	}
}
func TestMalformed(t *testing.T) {
	p := filepath.Join(t.TempDir(), "x")
	os.WriteFile(p, []byte("{"), 0600)
	if _, e := Load(p); e == nil {
		t.Fatal("wanted parse error")
	}
}

func TestRunFiltersAndExitCodes(t *testing.T) {
	base := writeDoc(t, d(map[string]any{"/other": map[string]any{"get": op("old")}}, nil))
	candidate := writeDoc(t, d(map[string]any{"/secret": map[string]any{"post": op("new")}}, nil))
	var out, errOut bytes.Buffer
	if code := Run([]string{"-path-prefix", "/secret", base, candidate}, &out, &errOut); code != 1 {
		t.Fatalf("code=%d stderr=%s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "added post /secret") {
		t.Fatalf("output=%q", out.String())
	}
	if code := Run([]string{base, base}, &out, &errOut); code != 0 {
		t.Fatalf("equal code=%d", code)
	}
	if code := Run([]string{"-method", "bogus", base, candidate}, &out, &errOut); code != 2 {
		t.Fatalf("invalid method code=%d", code)
	}
}

func TestPathPrefixMatchesWholeSegments(t *testing.T) {
	base := writeDoc(t, d(map[string]any{
		"/api/secretary": map[string]any{"get": op("old")},
	}, nil))
	candidate := writeDoc(t, d(map[string]any{
		"/api/secretary": map[string]any{"get": op("new")},
	}, nil))
	var output, errors bytes.Buffer
	if code := Run([]string{"-path-prefix", "/api/secret", base, candidate}, &output, &errors); code != 0 {
		t.Fatalf("sibling path was incorrectly selected: code=%d output=%q stderr=%q", code, output.String(), errors.String())
	}
}

func TestIsHTTPMethod(t *testing.T) {
	if !IsHTTPMethod("GET") || IsHTTPMethod("parameters") {
		t.Fatal("method classification is incorrect")
	}
}

func TestUppercaseOperationKeysAreRejected(t *testing.T) {
	document := d(map[string]any{
		"/x": map[string]any{"GET": op("x")},
	}, nil)
	if _, err := Load(writeDoc(t, document)); err == nil {
		t.Fatal("uppercase operation key was accepted")
	}
}

func TestRunJSONIncludesSnapshotsAndIsDeterministic(t *testing.T) {
	base := writeDoc(t, d(map[string]any{"/x": map[string]any{"get": op("old")}}, nil))
	candidate := writeDoc(t, d(map[string]any{"/x": map[string]any{"get": op("new")}}, nil))
	var first, second, stderr bytes.Buffer
	if code := Run([]string{"-json", base, candidate}, &first, &stderr); code != 1 {
		t.Fatalf("code=%d stderr=%s", code, stderr.String())
	}
	if code := Run([]string{"-json", base, candidate}, &second, &stderr); code != 1 || first.String() != second.String() {
		t.Fatalf("non-deterministic JSON output: %q / %q", first.String(), second.String())
	}
	var changes []Change
	if err := json.Unmarshal(first.Bytes(), &changes); err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || changes[0].Fields["operationId"] != [2]any{"old", "new"} {
		t.Fatalf("expected operation before/after value: %#v", changes)
	}
}

func TestPathItemMetadataAndEffectiveFields(t *testing.T) {
	pathParameter := map[string]any{"name": "id", "in": "path", "required": true, "schema": map[string]any{"type": "string"}}
	baseOperation := op("same")
	base := d(map[string]any{"/x": map[string]any{
		"summary":    "before",
		"parameters": []any{pathParameter},
		"x-meta":     "before",
		"get":        baseOperation,
	}}, nil)
	candidateOperation := op("same")
	candidate := d(map[string]any{"/x": map[string]any{
		"summary":    "after",
		"parameters": []any{pathParameter},
		"x-meta":     "after",
		"get":        candidateOperation,
	}}, nil)
	changes, err := Diff(base, candidate, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || changes[0].Method != "<path-item>" {
		t.Fatalf("path metadata was treated as a method: %#v", changes)
	}
	if _, err := Load(writeDoc(t, d(map[string]any{"/x": map[string]any{"parameters": []any{"not-object"}, "get": op("x")}}, nil))); err == nil {
		t.Fatal("malformed path parameters accepted")
	}
}

func TestEffectiveParametersSecurityAndReachableComponents(t *testing.T) {
	parameter := map[string]any{"name": "id", "in": "path", "required": true, "schema": map[string]any{"$ref": "#/components/schemas/Base"}}
	override := map[string]any{"name": "id", "in": "path", "required": true, "schema": map[string]any{"$ref": "#/components/schemas/Changed"}}
	base := d(map[string]any{"/x": map[string]any{"parameters": []any{parameter}, "get": map[string]any{
		"operationId": "same",
		"parameters":  []any{override},
		"security":    []any{map[string]any{"key/name": []any{}}},
		"responses":   map[string]any{"200": map[string]any{"description": "ok", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/Base"}}}}},
	}}}, map[string]any{
		"Base":        map[string]any{"type": "object", "properties": map[string]any{"nested": map[string]any{"$ref": "#/components/schemas/Nested~1Name"}}},
		"Nested/Name": map[string]any{"type": "string"},
		"Changed":     map[string]any{"type": "string"},
	})
	candidate := d(map[string]any{"/x": map[string]any{"parameters": []any{parameter}, "get": map[string]any{
		"operationId": "same",
		"parameters":  []any{override},
		"security":    []any{map[string]any{"key/name": []any{"scope"}}},
		"responses":   map[string]any{"200": map[string]any{"description": "ok", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/Base"}}}}},
	}}}, map[string]any{
		"Base":        map[string]any{"type": "object", "properties": map[string]any{"nested": map[string]any{"$ref": "#/components/schemas/Nested~1Name"}}},
		"Nested/Name": map[string]any{"type": "number"},
		"Changed":     map[string]any{"type": "integer"},
		"Unused":      map[string]any{"type": "boolean"},
	})
	base["components"].(map[string]any)["securitySchemes"] = map[string]any{"key/name": map[string]any{"type": "apiKey", "in": "header", "name": "x-key"}}
	candidate["components"].(map[string]any)["securitySchemes"] = map[string]any{"key/name": map[string]any{"type": "http", "scheme": "bearer"}}
	changes, err := Diff(base, candidate, "/x", "get")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, change := range changes {
		seen[change.Path] = true
	}
	for _, path := range []string{"/x", "#/components/schemas/Nested~1Name", "#/components/schemas/Changed", "#/components/securitySchemes/key~1name"} {
		if !seen[path] {
			t.Errorf("missing reachable change %s: %#v", path, changes)
		}
	}
	if seen["#/components/schemas/Unused"] {
		t.Error("unreachable component was reported")
	}
}

func TestValidationAndWriterErrors(t *testing.T) {
	valid := writeDoc(t, d(map[string]any{"/x": map[string]any{"get": op("x")}}, nil))
	invalidValues := []map[string]any{
		{"paths": map[string]any{}},
		{"openapi": "2.0.0", "paths": map[string]any{}},
		{"openapi": "3.1", "paths": map[string]any{}},
		{"openapi": "3.1.0", "paths": []any{}},
		{"openapi": "3.1.0", "paths": map[string]any{"x": map[string]any{}}},
		{"openapi": "3.1.0", "paths": map[string]any{"/x": map[string]any{"get": map[string]any{}}}},
		{"openapi": "3.1.0", "paths": map[string]any{"/x": map[string]any{"GET": op("x")}}},
		{"openapi": "3.1.0", "paths": map[string]any{}, "components": map[string]any{"unknown": map[string]any{}}},
		{"openapi": "3.1.0", "paths": map[string]any{"/x": map[string]any{"$ref": "#/components/pathItems/Missing"}}, "components": map[string]any{"pathItems": map[string]any{}}},
		{"openapi": "3.1.0", "paths": map[string]any{"/x": map[string]any{"get": map[string]any{"responses": map[string]any{"200": map[string]any{"content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/Thing/extra"}}}}}}}}, "components": map[string]any{"schemas": map[string]any{"Thing": map[string]any{"type": "string"}}}},
	}
	for index, value := range invalidValues {
		if _, err := Load(writeDoc(t, value)); err == nil {
			t.Errorf("invalid document %d accepted", index)
		}
	}
	emptyResponses := writeDoc(t, d(map[string]any{"/x": map[string]any{"get": map[string]any{"responses": map[string]any{}}}}, nil))
	if _, err := Load(emptyResponses); err != nil {
		t.Fatalf("structurally valid empty Responses Object rejected by default: %v", err)
	}
	if _, err := LoadStrict(emptyResponses); err == nil {
		t.Fatal("strict load accepted empty Responses Object")
	}
	var normalOutput, normalErrors bytes.Buffer
	if code := Run([]string{emptyResponses, emptyResponses}, &normalOutput, &normalErrors); code != 0 {
		t.Fatalf("default comparison rejected empty Responses Object: code=%d stderr=%s", code, normalErrors.String())
	}
	if code := Run([]string{"-strict", emptyResponses, emptyResponses}, &normalOutput, &normalErrors); code != 2 {
		t.Fatalf("strict comparison did not reject empty Responses Object: code=%d stderr=%s", code, normalErrors.String())
	}
	if code := Run([]string{valid, valid}, errorWriter{}, errorWriter{}); code != 2 {
		t.Fatalf("human output writer error code=%d", code)
	}
	if code := Run([]string{"-json", valid, valid}, errorWriter{}, errorWriter{}); code != 2 {
		t.Fatalf("JSON output writer error code=%d", code)
	}
}

func TestPathItemReferenceResolutionAndOAS31BooleanSchemas(t *testing.T) {
	base := map[string]any{
		"openapi": "3.1.0",
		"paths": map[string]any{"/x": map[string]any{
			"$ref":    "#/components/pathItems/Thing",
			"summary": "shared",
		}},
		"components": map[string]any{
			"pathItems": map[string]any{"Thing": map[string]any{
				"get": op("old"),
			}},
			"schemas": map[string]any{"BooleanSchema": false},
		},
	}
	candidate := map[string]any{
		"openapi": "3.1.0",
		"paths": map[string]any{"/x": map[string]any{
			"$ref":    "#/components/pathItems/Thing",
			"summary": "shared",
		}},
		"components": map[string]any{
			"pathItems": map[string]any{"Thing": map[string]any{
				"get": op("new"),
			}},
			"schemas": map[string]any{"BooleanSchema": true},
		},
	}
	basePathItem := base["paths"].(map[string]any)["/x"].(map[string]any)
	basePathItem["servers"] = []any{map[string]any{"url": "https://before.example"}}
	basePathItem["parameters"] = []any{map[string]any{"name": "id", "in": "path", "required": true, "schema": false}}
	candidatePathItem := candidate["paths"].(map[string]any)["/x"].(map[string]any)
	candidatePathItem["servers"] = []any{map[string]any{"url": "https://after.example"}}
	candidatePathItem["parameters"] = []any{map[string]any{"name": "id", "in": "path", "required": true, "schema": true}}
	baseOperation := base["components"].(map[string]any)["pathItems"].(map[string]any)["Thing"].(map[string]any)["get"].(map[string]any)
	candidateOperation := candidate["components"].(map[string]any)["pathItems"].(map[string]any)["Thing"].(map[string]any)["get"].(map[string]any)
	baseOperation["responses"].(map[string]any)["200"].(map[string]any)["content"] = map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/BooleanSchema"}}}
	candidateOperation["responses"].(map[string]any)["200"].(map[string]any)["content"] = map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/BooleanSchema"}}}
	baseOperation["parameters"] = []any{map[string]any{"name": "body", "in": "query", "schema": false}}
	candidateOperation["parameters"] = []any{map[string]any{"name": "body", "in": "query", "schema": true}}
	changes, err := Diff(base, candidate, "", "")
	if err != nil {
		t.Fatal(err)
	}
	var operationChanged, pathItemChanged, schemaChanged bool
	for _, change := range changes {
		switch {
		case change.Path == "/x" && strings.EqualFold(change.Method, http.MethodGet):
			operationChanged = true
		case change.Path == "#/components/pathItems/Thing":
			pathItemChanged = true
		case change.Path == "#/components/schemas/BooleanSchema":
			schemaChanged = true
		}
	}
	if !operationChanged || !pathItemChanged || !schemaChanged {
		t.Fatalf("path-item ref changes were not fully compared: %#v", changes)
	}
	if _, err := Load(writeDoc(t, base)); err != nil {
		t.Fatalf("valid OAS 3.1 boolean schemas rejected: %v", err)
	}
}

func TestNestedPathItemReferenceClosure(t *testing.T) {
	makeDocument := func(operationID string) map[string]any {
		return map[string]any{
			"openapi": "3.1.0",
			"paths":   map[string]any{"/nested": map[string]any{"$ref": "#/components/pathItems/A"}},
			"components": map[string]any{"pathItems": map[string]any{
				"A": map[string]any{"$ref": "#/components/pathItems/B"},
				"B": map[string]any{"get": op(operationID)},
			}},
		}
	}
	changes, err := Diff(makeDocument("old"), makeDocument("new"), "", "")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, change := range changes {
		seen[change.Path+" "+change.Method] = true
	}
	if !seen["/nested get"] || !seen["#/components/pathItems/B component"] {
		t.Fatalf("nested path-item references were not resolved: %#v", changes)
	}
}

type errorWriter struct{}

func (errorWriter) Write([]byte) (int, error) {
	return 0, errors.New("write failed")
}

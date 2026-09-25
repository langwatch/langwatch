package openapidiff

import (
	"encoding/json"
	"testing"
)

func decode(t *testing.T, text string) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func kinds(changes []FieldChange) map[string]string {
	result := map[string]string{}
	for _, change := range changes {
		result[change.Kind+" "+change.Field] = change.Class
	}
	return result
}

func TestFlattenSchemaResolvesRefsAndNullability(t *testing.T) {
	document := decode(t, `{
	  "components": {"schemas": {"Item": {"type": "object", "required": ["id"], "properties": {"id": {"type": "string"}}}}},
	  "type": "object",
	  "required": ["items"],
	  "properties": {
	    "items": {"type": "array", "items": {"$ref": "#/components/schemas/Item"}},
	    "note": {"anyOf": [{"type": "string"}, {"type": "null"}]}
	  }
	}`)
	fields := FlattenSchema(document, document)
	if field := fields["items[].id"]; !field.Required || len(field.Types) != 1 || field.Types[0] != "string" {
		t.Errorf("items[].id = %+v", field)
	}
	if field := fields["note"]; field.Required || !field.Nullable || field.Types[0] != "string" {
		t.Errorf("note = %+v", field)
	}
}

func TestCompareSchemasRequestDirection(t *testing.T) {
	base := FlattenSchema(nil, decode(t, `{"type": "object", "required": ["a"], "properties": {"a": {"type": "string"}, "b": {"type": "integer"}, "gone": {"type": "object", "properties": {"x": {"type": "string"}}}}}`))
	candidate := FlattenSchema(nil, decode(t, `{"type": "object", "required": ["a", "b", "must"], "properties": {"a": {"type": ["string", "number"]}, "b": {"type": "integer"}, "must": {"type": "string"}, "may": {"type": "string"}}}`))
	got := kinds(Comparison{Direction: Request, Prefix: "body"}.Compare(base, candidate))
	want := map[string]string{
		"property_removed body.gone": ClassBreaking,
		"property_added body.must":   ClassBreaking,
		"property_added body.may":    ClassAdditive,
		"type_changed body.a":        ClassAdditive,
		"required_changed body.b":    ClassBreaking,
	}
	for key, class := range want {
		if got[key] != class {
			t.Errorf("%s = %q, want %q (all: %v)", key, got[key], class, got)
		}
	}
	if _, reported := got["property_removed body.gone.x"]; reported {
		t.Errorf("a removed parent's child is reported again: %v", got)
	}
}

func TestCompareSchemasResponseDirection(t *testing.T) {
	base := FlattenSchema(nil, decode(t, `{"type": "object", "required": ["id"], "properties": {"id": {"type": "string"}, "count": {"type": "integer"}}}`))
	candidate := FlattenSchema(nil, decode(t, `{"type": "object", "properties": {"id": {"type": "string"}, "count": {"type": ["integer", "null"]}, "extra": {"type": "string"}}}`))
	got := kinds(Comparison{Direction: Response, Prefix: "200"}.Compare(base, candidate))
	want := map[string]string{
		"required_changed 200.id":  ClassBreaking,
		"type_changed 200.count":   ClassBreaking,
		"property_added 200.extra": ClassAdditive,
	}
	for key, class := range want {
		if got[key] != class {
			t.Errorf("%s = %q, want %q (all: %v)", key, got[key], class, got)
		}
	}
}

func TestClassifyOperationSplitsFields(t *testing.T) {
	base := decode(t, `{"components": {"schemas": {"Thing": {"type": "object", "properties": {"name": {"type": "string"}}}}}}`)
	candidate := decode(t, `{"components": {"schemas": {"Renamed": {"type": "object", "properties": {"name": {"type": "string"}}}}}}`)
	change := Change{Kind: "changed", Path: "/api/things", Method: "post", Fields: map[string][2]any{
		"parameters": {
			[]any{map[string]any{"name": "limit", "in": "query"}, map[string]any{"name": "tenant", "in": "query"}},
			[]any{map[string]any{"name": "limit", "in": "query", "required": true}, map[string]any{"name": "cursor", "in": "query"}},
		},
		"requestBody": {
			map[string]any{"content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/Thing"}}}},
			map[string]any{"content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/Renamed"}}}},
		},
		"responses": {
			map[string]any{"200": map[string]any{}, "404": map[string]any{}},
			map[string]any{"200": map[string]any{}, "201": map[string]any{}},
		},
		"security": {[]any{map[string]any{"a": []any{}}}, []any{map[string]any{"b": []any{}}}},
		"summary":  {"old", "new"},
	}}
	got := kinds(ClassifyOperation(base, candidate, change))
	want := map[string]string{
		"param_required_changed query.limit": ClassBreaking,
		"param_removed query.tenant":         ClassBreaking,
		"param_added query.cursor":           ClassAdditive,
		"status_removed 404":                 ClassBreaking,
		"status_added 201":                   ClassAdditive,
		"security_changed security":          ClassBreaking,
		"docs_changed summary":               ClassAdditive,
	}
	for key, class := range want {
		if got[key] != class {
			t.Errorf("%s = %q, want %q (all: %v)", key, got[key], class, got)
		}
	}
	for key := range got {
		if len(key) > 8 && key[:8] == "request_" {
			t.Errorf("a component rename with identical content reported %s", key)
		}
	}
}

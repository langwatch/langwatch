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
		"status_removed 404":                 ClassNotCompared,
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

// Parity rulings, 2026-09-25: a documented error status is not compared, a
// body only the base documents is one finding, and a base node left open
// (recursive schemas emitted as {}) makes what lies under it unknown.
func TestDocumentedErrorStatusesAreNotCompared(t *testing.T) {
	change := Change{Kind: "changed", Path: "/api/x", Method: "get", Fields: map[string][2]any{"responses": {
		map[string]any{"200": map[string]any{}, "401": map[string]any{}, "500": map[string]any{}},
		map[string]any{"200": map[string]any{}, "422": map[string]any{}},
	}}}
	got := kinds(ClassifyOperation(nil, nil, change))
	for _, key := range []string{"status_removed 401", "status_removed 500", "status_added 422"} {
		if got[key] != ClassNotCompared {
			t.Errorf("%s = %q, want %q (all: %v)", key, got[key], ClassNotCompared, got)
		}
	}
}

func TestRequestBodyUndocumentedIsOneBreakingChange(t *testing.T) {
	body := func(schema string) map[string]any {
		return decode(t, `{"content": {"application/json": {"schema": `+schema+`}}}`)
	}
	change := Change{Kind: "changed", Path: "/api/x", Method: "post", Fields: map[string][2]any{"requestBody": {
		body(`{"type": "object", "properties": {"a": {"type": "string"}, "b": {"type": "integer"}, "c": {"type": "object", "properties": {"d": {"type": "string"}}}}}`),
		body(`{}`),
	}}}
	changes := ClassifyOperation(nil, nil, change)
	if len(changes) != 1 || changes[0].Kind != "request_body_undocumented" || changes[0].Class != ClassBreaking {
		t.Fatalf("changes = %+v, want one breaking request_body_undocumented", changes)
	}
	added := Change{Kind: "changed", Path: "/api/x", Method: "post", Fields: map[string][2]any{"requestBody": {nil, map[string]any{"required": true, "content": map[string]any{}}}}}
	if got := kinds(ClassifyOperation(nil, nil, added)); got["request_body_added body"] != ClassAdditive {
		t.Errorf("a body main never documented is additive documentation: %v", got)
	}
}

func TestChangesUnderAnOpenBaseNodeAreUnknown(t *testing.T) {
	base := FlattenSchema(nil, decode(t, `{"type": "object", "required": ["dsl"], "properties": {"dsl": {"type": "object", "required": ["nodes"], "properties": {"nodes": {"type": "array"}, "config": {"type": "object", "additionalProperties": {}}}}}}`))
	candidate := FlattenSchema(nil, decode(t, `{"type": "object", "required": ["dsl"], "properties": {"dsl": {"type": "object", "required": ["nodes", "state"], "properties": {"nodes": {"type": "array", "items": {"type": "object", "required": ["id"], "properties": {"id": {"type": "string"}}}}, "config": {"type": "object", "required": ["url"], "properties": {"url": {"type": "string"}}}, "state": {"type": "object"}}}}}`))
	got := kinds(Comparison{Direction: Request, Prefix: "input"}.Compare(base, candidate))
	want := map[string]string{
		"property_added input.dsl.nodes[]":    ClassUnknown,
		"property_added input.dsl.config.url": ClassUnknown,
		"property_added input.dsl.state":      ClassBreaking,
	}
	for key, class := range want {
		if got[key] != class {
			t.Errorf("%s = %q, want %q (all: %v)", key, got[key], class, got)
		}
	}
	recursive := decode(t, `{"$defs": {"Node": {"type": "object", "properties": {"children": {"type": "array", "items": {"$ref": "#/$defs/Node"}}}}}, "$ref": "#/$defs/Node"}`)
	fields := FlattenSchema(recursive, recursive)
	if !fields["children[]"].Open {
		t.Errorf("a recursive reference is not open: %+v", fields["children[]"])
	}
}

// Parity ruling 7, 2026-09-25: a nullable object written as anyOf [object, null]
// keeps its required list, so it compares equal to main's nullable object.
func TestNullableObjectKeepsItsRequiredList(t *testing.T) {
	base := FlattenSchema(nil, decode(t, `{"type": "object", "properties": {"mostUsedModel": {"type": ["object", "null"], "required": ["name", "usagePct"], "properties": {"name": {"type": "string"}, "usagePct": {"type": "number"}}}}}`))
	candidate := FlattenSchema(nil, decode(t, `{"type": "object", "properties": {"mostUsedModel": {"anyOf": [{"type": "object", "required": ["name", "usagePct"], "properties": {"name": {"type": "string"}, "usagePct": {"type": "number"}}}, {"type": "null"}]}}}`))
	if field := candidate["mostUsedModel.name"]; !field.Required {
		t.Fatalf("mostUsedModel.name lost its required flag: %+v", field)
	}
	if changes := (Comparison{Direction: Response, Prefix: "200"}).Compare(base, candidate); len(changes) != 0 {
		t.Errorf("identical nullable objects differ: %+v", changes)
	}
	either := FlattenSchema(nil, decode(t, `{"anyOf": [{"type": "object", "required": ["a"], "properties": {"a": {"type": "string"}}}, {"type": "object", "required": ["b"], "properties": {"b": {"type": "string"}}}]}`))
	if either["a"].Required || either["b"].Required {
		t.Errorf("a two-object anyOf made its properties required: %+v", either)
	}
}

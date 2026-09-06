package apidiff

import (
	"reflect"
	"testing"
)

func TestSynthesizePayloadTypes(t *testing.T) {
	schema := map[string]any{
		"type":     "object",
		"required": []any{"name", "at", "count", "flag", "tags"},
		"properties": map[string]any{
			"name":    map[string]any{"type": "string"},
			"at":      map[string]any{"type": "string", "format": "date-time"},
			"id":      map[string]any{"type": "string", "format": "uuid"},
			"count":   map[string]any{"type": "integer"},
			"flag":    map[string]any{"type": "boolean"},
			"tags":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			"ignored": map[string]any{"type": "string"},
		},
	}
	got := SynthesizePayload(schema, 0)
	want := map[string]any{
		"name":  "apidiff",
		"at":    "2026-01-01T00:00:00Z",
		"count": float64(1),
		"flag":  true,
		"tags":  []any{"apidiff"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("SynthesizePayload = %#v, want %#v", got, want)
	}
}

func TestSynthesizePayloadPrefersExampleAndEnum(t *testing.T) {
	withExample := map[string]any{"type": "string", "example": "from-spec"}
	if got := SynthesizePayload(withExample, 0); got != "from-spec" {
		t.Fatalf("example = %v, want from-spec", got)
	}
	withEnum := map[string]any{"type": "string", "enum": []any{"first", "second"}}
	if got := SynthesizePayload(withEnum, 0); got != "first" {
		t.Fatalf("enum = %v, want first", got)
	}
}

func TestSynthesizePayloadDepthCap(t *testing.T) {
	var nest func(depth int) map[string]any
	nest = func(depth int) map[string]any {
		if depth == 0 {
			return map[string]any{"type": "string"}
		}
		return map[string]any{"type": "object", "properties": map[string]any{
			"child": nest(depth - 1),
		}}
	}
	// Six levels deep: the object at depth 5 is past the cap and collapses.
	got := SynthesizePayload(nest(6), 0).(map[string]any)
	current := got
	for range 4 {
		current = current["child"].(map[string]any)
	}
	capped := current["child"]
	if !reflect.DeepEqual(capped, map[string]any{}) {
		t.Fatalf("past the depth cap want empty object, got %#v", capped)
	}
}

func TestValidationBody(t *testing.T) {
	required := map[string]any{"type": "object", "required": []any{"name"}, "properties": map[string]any{
		"name": map[string]any{"type": "string"},
	}}
	if got := ValidationBody(required); !reflect.DeepEqual(got, map[string]any{}) {
		t.Fatalf("required schema = %#v, want empty object", got)
	}
	optional := map[string]any{"type": "object", "properties": map[string]any{
		"size": map[string]any{"type": "integer"},
		"name": map[string]any{"type": "string"},
	}}
	got := ValidationBody(optional)
	want := map[string]any{"name": map[string]any{}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("type-confused body = %#v, want %#v", got, want)
	}
}

func TestSymbolTableCaptureAndLookup(t *testing.T) {
	table := NewSymbolTable()
	if _, ok := table.Lookup("id", "/api/things"); ok {
		t.Fatal("empty table must not resolve")
	}
	table.Capture("/api/things", map[string]any{
		"id":   "thing-1",
		"name": "not-an-id",
		"nested": map[string]any{
			"projectId": "project-9",
		},
	})
	if got, ok := table.Lookup("thingId", "/api/things"); !ok || got != "thing-1" {
		t.Fatalf("Lookup(thingId) = %q, %v; want thing-1", got, ok)
	}
	if got, ok := table.Lookup("id", "/api/things/{id}"); !ok || got != "thing-1" {
		t.Fatalf("bare {id} on /api/things/{id} = %q, %v; want thing-1", got, ok)
	}
	if got, ok := table.Lookup("projectId", "/api/other"); !ok || got != "project-9" {
		t.Fatalf("Lookup(projectId) = %q, %v; want project-9", got, ok)
	}
}

// The untyped catch-all is what put a trace id into {promptId}: a table that
// holds no prompt id must resolve nothing, so the operation is skipped.
func TestLookupIsTypeScoped(t *testing.T) {
	table := NewSymbolTable()
	table.Capture("/api/traces", map[string]any{"traceId": "trace-1"})
	if got, ok := table.Lookup("promptId", "/api/prompts/{promptId}"); ok {
		t.Fatalf("promptId resolved to %q from a table holding only a trace id", got)
	}
	if got, ok := table.Lookup("traceId", "/api/traces/{traceId}"); !ok || got != "trace-1" {
		t.Fatalf("traceId = %q, %v; want trace-1", got, ok)
	}
}

func TestNoUntypedFallback(t *testing.T) {
	table := NewSymbolTable()
	table.Capture("/api/traces", map[string]any{"id": "trace-1"})
	if got, ok := table.Lookup("id", "/api/prompts/{id}"); ok {
		t.Fatalf("bare {id} on /api/prompts resolved to %q captured from /api/traces", got)
	}
	if got, ok := table.Lookup("evaluatorId", "/api/evaluators/{evaluatorId}"); ok {
		t.Fatalf("evaluatorId resolved to %q with no evaluator id captured", got)
	}
}

func TestResourceParamName(t *testing.T) {
	cases := []struct{ path, want string }{
		{"/api/prompts", "promptid"},
		{"/api/prompts/{id}", "promptid"},
		{"/api/v1/prompts/{id}/versions", "versionid"},
		{"/api/evaluators/{idOrSlug}", "evaluatorid"},
		{"/", ""},
	}
	for _, testCase := range cases {
		if got := resourceParamName(testCase.path); got != testCase.want {
			t.Errorf("resourceParamName(%q) = %q, want %q", testCase.path, got, testCase.want)
		}
	}
}

func TestResolveParamPrecedence(t *testing.T) {
	symbols := NewSymbolTable()
	symbols.Capture("/api/things", map[string]any{"id": "captured-1"})

	example := Param{Name: "slug", In: "path", Required: true, Example: "spec-example", HasValue: true}
	if got, ok := ResolveParam(example, symbols, "/api/things/{slug}"); !ok || got != "spec-example" {
		t.Fatalf("example resolution = %q, %v", got, ok)
	}
	seeded := Param{Name: "projectId", In: "path", Required: true}
	if got, ok := ResolveParam(seeded, symbols, "/api/things/{projectId}"); !ok || got != "local-dev-project" {
		t.Fatalf("seeded resolution = %q, %v", got, ok)
	}
	captured := Param{Name: "thingId", In: "path", Required: true}
	if got, ok := ResolveParam(captured, symbols, "/api/things/{thingId}"); !ok || got != "captured-1" {
		t.Fatalf("captured resolution = %q, %v", got, ok)
	}
	empty := NewSymbolTable()
	if _, ok := ResolveParam(captured, empty, "/api/things/{thingId}"); ok {
		t.Fatal("unresolvable param must fail")
	}
}

package apidiff

import (
	"strings"
	"testing"
)

func TestShapeOfObjectSortedKeys(t *testing.T) {
	shape := ShapeOf(map[string]any{"b": "x", "a": float64(1), "c": true})
	got := shape.Signature()
	want := `object{"a":number,"b":string,"c":boolean}`
	if got != want {
		t.Fatalf("Signature() = %q, want %q", got, want)
	}
}

func TestShapeOfArrayUnionAndLength(t *testing.T) {
	uniform := ShapeOf([]any{"a", "b"})
	if got, want := uniform.Signature(), "array[string]#2"; got != want {
		t.Fatalf("uniform array = %q, want %q", got, want)
	}
	mixed := ShapeOf([]any{"a", float64(1)})
	if got := mixed.Signature(); !strings.HasPrefix(got, "array[union(") || !strings.Contains(got, "number") || !strings.Contains(got, "string") {
		t.Fatalf("mixed array = %q, want union of number|string", got)
	}
	// Array length is part of the shape.
	if ShapeOf([]any{"a"}).Signature() == ShapeOf([]any{"a", "b"}).Signature() {
		t.Fatal("arrays of different length must have different signatures")
	}
}

func TestIsVolatileKey(t *testing.T) {
	volatile := []string{"id", "project_id", "projectId", "created_at", "updatedAt", "timestamp", "token", "api_key", "passwordHash", "secret", "platformUrl", "url", "slug", "path"}
	for _, key := range volatile {
		if !IsVolatileKey(key) {
			t.Errorf("IsVolatileKey(%q) = false, want true", key)
		}
	}
	stable := []string{"name", "status", "message", "count", "identity", "slugline"}
	for _, key := range stable {
		if IsVolatileKey(key) {
			t.Errorf("IsVolatileKey(%q) = true, want false", key)
		}
	}
}

func TestMaskValue(t *testing.T) {
	body := map[string]any{
		"id":         "abc-123",
		"created_at": "2026-01-01T00:00:00Z",
		"name":       "stable",
		"nested": map[string]any{
			"token": "sekret",
			"value": float64(42),
		},
		"items": []any{map[string]any{"id": "x", "label": "y"}},
	}
	masked := MaskValue(body).(map[string]any)
	if masked["id"] != "<masked:string>" {
		t.Errorf("id = %v, want <masked:string>", masked["id"])
	}
	if masked["name"] != "stable" {
		t.Errorf("name = %v, want untouched", masked["name"])
	}
	nested := masked["nested"].(map[string]any)
	if nested["token"] != "<masked:string>" || nested["value"] != float64(42) {
		t.Errorf("nested = %v, want token masked and value kept", nested)
	}
	items := masked["items"].([]any)
	if items[0].(map[string]any)["id"] != "<masked:string>" {
		t.Errorf("array element id not masked: %v", items[0])
	}
}

func TestMaskedKindMismatch(t *testing.T) {
	// Same key, different value kinds: kinds still differ after masking.
	before := map[string]any{"id": "abc"}
	after := map[string]any{"id": float64(7)}
	fields := valueDiffFields(MaskValue(before), MaskValue(after))
	if len(fields) != 1 {
		t.Fatalf("expected one masked-kind diff, got %v", fields)
	}
	got := fields["/id"]
	if got[0] != "<masked:string>" || got[1] != "<masked:number>" {
		t.Fatalf("masked kinds = %v, want <masked:string> vs <masked:number>", got)
	}
}

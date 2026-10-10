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

/** @scenario "A value this deployment minted is masked whatever key it sits under" */
func TestMaskValueMasksMintedIdentifiers(t *testing.T) {
	t.Parallel()
	// The handle the server generated for a create that named none. Two
	// instances can never mint the same one.
	masked := MaskValue(map[string]any{
		"handle": "prompt_SXOhgbwO562oHxriy267L",
		"name":   "prompt_JMnnWqXvNsxJeLjStt4nj",
		"model":  "openai/gpt-5",
	})
	got := masked.(map[string]any)
	if got["handle"] != "<masked:string>" || got["name"] != "<masked:string>" {
		t.Errorf("minted ids not masked: %v", got)
	}
	if got["model"] != "openai/gpt-5" {
		t.Errorf("model = %v, want untouched", got["model"])
	}
}

func TestIsMintedIdentifierKeepsStableNames(t *testing.T) {
	t.Parallel()
	for _, minted := range []string{
		"prompt_SXOhgbwO562oHxriy267L",
		"ptag_zVtGjTm5f2O9PhW2DoKfe",
		"prompt_version_ZSM0u4FpxjhJwMNQm4Bgs",
		"suite_0007SaVaq9cXCAiGgqSjx2shhCgSW",
	} {
		if !IsMintedIdentifier(minted) {
			t.Errorf("%s: want minted", minted)
		}
	}
	// Stable values that must keep comparing, or real drift goes unseen.
	for _, stable := range []string{
		"system_anthropic", "local-dev-project", "local-dev-model-default-config",
		"openai/gpt-5", "production", "admin@haven.localhost",
		"urn:ietf:params:scim:schemas:core:2.0:User", "", "TEAM",
	} {
		if IsMintedIdentifier(stable) {
			t.Errorf("%s: want stable, got minted", stable)
		}
	}
}

/** @scenario "SCIM's own spelling of a timestamp is masked like every other" */
func TestMaskValueMasksScimTimestamps(t *testing.T) {
	t.Parallel()
	masked := MaskValue(map[string]any{"meta": map[string]any{
		"resourceType": "User",
		"created":      "2026-09-21T08:57:13.433Z",
		"lastModified": "2026-09-21T08:57:13.525Z",
	}})
	meta := masked.(map[string]any)["meta"].(map[string]any)
	if meta["created"] != "<masked:string>" || meta["lastModified"] != "<masked:string>" {
		t.Errorf("SCIM timestamps not masked: %v", meta)
	}
	if meta["resourceType"] != "User" {
		t.Errorf("resourceType = %v, want untouched", meta["resourceType"])
	}
}

package diffkit

import "testing"

func TestSynthesizePayloadEmitsRequiredFieldsOnly(t *testing.T) {
	schema := map[string]any{
		"type":     "object",
		"required": []any{"name"},
		"properties": map[string]any{
			"name":     map[string]any{"type": "string"},
			"optional": map[string]any{"type": "string"},
		},
	}
	body, ok := SynthesizePayload(schema, 0).(map[string]any)
	if !ok {
		t.Fatalf("want an object, got %T", SynthesizePayload(schema, 0))
	}
	if _, present := body["name"]; !present {
		t.Fatalf("required field missing: %v", body)
	}
	if _, present := body["optional"]; present {
		t.Fatalf("optional field emitted: %v", body)
	}
}

func TestSynthesizePayloadIsFormatAware(t *testing.T) {
	if got := SynthesizePayload(map[string]any{"type": "string", "format": "email"}, 0); got != synthEmail {
		t.Fatalf("email format not honoured: %v", got)
	}
}

func TestSynthesizePayloadTakesEnumFirst(t *testing.T) {
	if got := SynthesizePayload(map[string]any{"type": "string", "enum": []any{"a", "b"}}, 0); got != "a" {
		t.Fatalf("enum first value not taken: %v", got)
	}
}

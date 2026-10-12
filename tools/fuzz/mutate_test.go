package fuzz

import (
	"reflect"
	"testing"
)

func writeSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []any{"name"},
		"properties": map[string]any{
			"name":  map[string]any{"type": "string"},
			"count": map[string]any{"type": "number"},
		},
	}
}

func TestMutateBodyIsDeterministic(t *testing.T) {
	schema := writeSchema()
	for _, mutation := range Mutations {
		valid := map[string]any{"name": "fuzzer", "count": float64(1)}
		first := MutateBody(schema, cloneForTest(valid), mutation)
		second := MutateBody(schema, cloneForTest(valid), mutation)
		if !reflect.DeepEqual(first, second) {
			t.Fatalf("mutation %s not deterministic: %v vs %v", mutation.Name, first, second)
		}
	}
}

func TestMutateBodyMissingRequiredDropsRequiredKey(t *testing.T) {
	out := MutateBody(writeSchema(), map[string]any{"name": "fuzzer", "count": float64(1)}, Mutation{Name: "missing-required", SchemaInvalid: true})
	body := out.(map[string]any)
	if _, present := body["name"]; present {
		t.Fatalf("missing-required kept the required key: %v", body)
	}
}

func TestMutateBodyWrongTypeConfusesFirstString(t *testing.T) {
	out := MutateBody(writeSchema(), map[string]any{"name": "fuzzer"}, Mutation{Name: "wrong-type", SchemaInvalid: true})
	if _, isObject := out.(map[string]any)["name"].(map[string]any); !isObject {
		t.Fatalf("wrong-type did not confuse the string field: %v", out)
	}
}

func TestMutateBodyExtraKeysAddsUnexpected(t *testing.T) {
	out := MutateBody(writeSchema(), map[string]any{"name": "fuzzer"}, Mutation{Name: "extra-keys"})
	if _, present := out.(map[string]any)["__fuzz_extra"]; !present {
		t.Fatalf("extra-keys added nothing: %v", out)
	}
}

func cloneForTest(value map[string]any) map[string]any {
	clone := map[string]any{}
	for key, item := range value {
		clone[key] = item
	}
	return clone
}

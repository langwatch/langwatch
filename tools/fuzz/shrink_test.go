package fuzz

import "testing"

// The oracle here fires whenever the body still carries "trigger": ShrinkBody
// must strip every other key and keep that one.
func TestShrinkBodyReducesToTheMinimalReproducingKey(t *testing.T) {
	body := map[string]any{"trigger": true, "a": 1, "b": 2, "c": 3}
	reproduces := func(trial map[string]any) bool {
		_, held := trial["trigger"]
		return held
	}
	minimal := ShrinkBody(body, reproduces)
	if len(minimal) != 1 {
		t.Fatalf("want a single key, got %v", minimal)
	}
	if _, held := minimal["trigger"]; !held {
		t.Fatalf("shrink dropped the reproducing key: %v", minimal)
	}
}

func TestShrinkBodyKeepsEverythingWhenNoSubsetReproduces(t *testing.T) {
	body := map[string]any{"a": 1, "b": 2}
	minimal := ShrinkBody(body, func(map[string]any) bool { return false })
	if len(minimal) != 2 {
		t.Fatalf("want the body unchanged, got %v", minimal)
	}
}

func TestShrinkBodyIsDeterministic(t *testing.T) {
	body := map[string]any{"trigger": true, "x": 1, "y": 2}
	oracle := func(trial map[string]any) bool { _, held := trial["trigger"]; return held }
	first := ShrinkBody(clone(body), oracle)
	second := ShrinkBody(clone(body), oracle)
	if len(first) != len(second) {
		t.Fatalf("non-deterministic shrink: %v vs %v", first, second)
	}
}

func clone(value map[string]any) map[string]any {
	out := map[string]any{}
	for key, item := range value {
		out[key] = item
	}
	return out
}

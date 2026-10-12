package fuzz

import (
	"testing"

	"github.com/langwatch/langwatch/tools/diffkit"
)

func jobKey(item job) string {
	return item.op.Method + " " + item.op.Path + " " + item.auth + " " + item.mutation.Name
}

func planOperations() []diffkit.Operation {
	return []diffkit.Operation{
		{Method: "GET", Path: "/api/a/{id}"},
		{Method: "POST", Path: "/api/b", BodySchema: map[string]any{"type": "object", "required": []any{"name"}, "properties": map[string]any{"name": map[string]any{"type": "string"}}}},
	}
}

func planFor(seed int64) []job {
	run := &apiRun{options: Options{Seed: seed, Duration: 0}}
	return run.plan(planOperations())
}

func TestPlanIsDeterministicPerSeed(t *testing.T) {
	first, second := planFor(7), planFor(7)
	if len(first) != len(second) {
		t.Fatalf("plan length varied for one seed: %d vs %d", len(first), len(second))
	}
	for index := range first {
		if jobKey(first[index]) != jobKey(second[index]) {
			t.Fatalf("plan order varied for one seed at %d", index)
		}
	}
}

func TestPlanDiffersAcrossSeeds(t *testing.T) {
	a, b := planFor(1), planFor(2)
	same := len(a) == len(b)
	if same {
		for index := range a {
			if jobKey(a[index]) != jobKey(b[index]) {
				same = false
				break
			}
		}
	}
	if same {
		t.Fatal("two seeds produced the same order; the shuffle is not seeded")
	}
}

func TestPlanSkipsBodyMutationsForBodylessOperations(t *testing.T) {
	run := &apiRun{options: Options{Seed: 1}}
	for _, item := range run.plan([]diffkit.Operation{{Method: "GET", Path: "/api/a"}}) {
		if item.mutation.SchemaInvalid {
			t.Fatalf("body mutation planned for a bodyless operation: %s", item.mutation.Name)
		}
	}
}

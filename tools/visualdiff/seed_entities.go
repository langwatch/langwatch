package visualdiff

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// Seeded fixture names: the {name} placeholders a stack's seed fills with the
// id its own server generated, so they differ per side (run.go keeps them per side).
const (
	FixtureDataset    = "dataset"
	FixtureExperiment = "experiment"
	FixtureMonitor    = "monitor"
	FixtureGraph      = "graph"
	FixtureVirtualKey = "virtualKey"
	FixtureBudget     = "budget"
)

// SeededFixtureNames are the placeholders a route may name without a static
// fixture in visualdiff.yaml, because the seed fills them.
var SeededFixtureNames = []string{
	FixtureDataset, FixtureExperiment, FixtureMonitor, FixtureGraph, FixtureVirtualKey, FixtureBudget,
}

// entitySeed is one entity posted through a REST surface main and the branch
// both serve. body sees the fixtures seeded before it; idPath is the
// dot-separated path to the id in the answer.
type entitySeed struct {
	fixture string
	path    string
	body    func(fixtures map[string]string) map[string]any
	idPath  string
	// needs names the fixtures that must already be seeded for this one.
	needs []string
}

// evaluatorKey is not a route fixture: the monitor needs an evaluator to exist.
const evaluatorKey = "evaluator"

// entitySeeds are the dynamic routes' entities, in the order they depend on each other.
var entitySeeds = []entitySeed{
	{
		fixture: FixtureExperiment, path: "/api/experiments", idPath: "slug",
		body: func(map[string]string) map[string]any { return map[string]any{"name": "Visual Diff Experiment"} },
	},
	{
		fixture: evaluatorKey, path: "/api/evaluators", idPath: "id",
		body: func(map[string]string) map[string]any {
			return map[string]any{"name": "Visual Diff Evaluator", "config": map[string]any{"evaluatorType": "langevals/exact_match"}}
		},
	},
	{
		fixture: FixtureMonitor, path: "/api/monitors", idPath: "id", needs: []string{evaluatorKey},
		body: func(fixtures map[string]string) map[string]any {
			return map[string]any{
				"name": "Visual Diff Monitor", "checkType": "langevals/exact_match",
				"evaluatorId": fixtures[evaluatorKey], "sample": 1,
			}
		},
	},
	{
		fixture: FixtureGraph, path: "/api/graphs", idPath: "id",
		body: func(map[string]string) map[string]any {
			series := map[string]any{"metric": "metadata.trace_id", "aggregation": "cardinality", "name": "Traces", "colorSet": "orangeTones"}
			graph := map[string]any{"graphType": "line", "series": []any{series}, "includePrevious": false, "timeScale": 60}
			return map[string]any{"name": "Visual Diff Graph", "graph": graph}
		},
	},
	{
		fixture: FixtureVirtualKey, path: "/api/gateway/v1/virtual-keys", idPath: "virtual_key.id",
		body: func(map[string]string) map[string]any { return map[string]any{"name": "Visual Diff Key"} },
	},
	{
		fixture: FixtureBudget, path: "/api/gateway/v1/budgets", idPath: "budget.id", needs: []string{FixtureVirtualKey},
		body: func(fixtures map[string]string) map[string]any {
			return map[string]any{
				"scope": map[string]any{"kind": "virtual_key", "virtual_key_id": fixtures[FixtureVirtualKey]},
				"name":  "Visual Diff Budget", "window": "month", "limit_usd": 100,
			}
		},
	},
}

// entityRequest is one stack's entity seeding: where to post, as which key.
type entityRequest struct {
	client *http.Client
	apiURL string
	key    string
	seeds  []entitySeed
}

// seedEntities posts each entity and keeps its id. One that fails, or whose
// prerequisite failed, is a warning and no fixture: its route then renders
// that side's not-found state, which the report shows, instead of the whole run dying.
func seedEntities(ctx context.Context, request entityRequest) (fixtures map[string]string, warnings []string) {
	fixtures = map[string]string{}
	for _, seed := range request.seeds {
		if missing := firstMissing(fixtures, seed.needs); missing != "" {
			warnings = append(warnings, fmt.Sprintf("%s not seeded: needs %s, which was not", seed.fixture, missing))
			continue
		}
		spec := postSpec{url: request.apiURL + seed.path, key: request.key, body: seed.body(fixtures)}
		answer, err := postReading(ctx, request.client, spec)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s not seeded: %v", seed.fixture, err))
			continue
		}
		id, err := StringAt(answer, seed.idPath)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s not seeded: %s answered without %s: %v", seed.fixture, seed.path, seed.idPath, err))
			continue
		}
		fixtures[seed.fixture] = id
	}
	delete(fixtures, evaluatorKey)
	return fixtures, warnings
}

func firstMissing(fixtures map[string]string, needs []string) string {
	for _, need := range needs {
		if fixtures[need] == "" {
			return need
		}
	}
	return ""
}

// StringAt reads the non-empty string at a dot-separated path in a JSON body.
func StringAt(body []byte, path string) (string, error) {
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		return "", err
	}
	for _, key := range strings.Split(path, ".") {
		object, ok := value.(map[string]any)
		if !ok {
			return "", fmt.Errorf("%s is not an object", key)
		}
		value = object[key]
	}
	text, ok := value.(string)
	if !ok || text == "" {
		return "", fmt.Errorf("no string at %s", path)
	}
	return text, nil
}

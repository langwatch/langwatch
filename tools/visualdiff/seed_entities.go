package visualdiff

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"strings"
	"sync"
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
	FixtureErrorTrace, FixtureConversation, FixtureBugReport, FixtureIsolatedSlug, FixtureIsolatedKey,
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

// seedEntities posts each entity and keeps its id, in waves: every entity whose
// prerequisites are settled posts at once. One that fails, or whose prerequisite
// failed, is a warning and no fixture: its route then renders that side's
// not-found state, which the report shows, instead of the whole run dying.
func seedEntities(ctx context.Context, request entityRequest) (map[string]string, []string) {
	fixtures := map[string]string{}
	var warnings []string
	var mutex sync.Mutex
	settled := map[string]bool{}
	for pending := request.seeds; len(pending) > 0; {
		var wave, later []entitySeed
		for _, seed := range pending {
			if waitsOn(seed, settled) {
				later = append(later, seed)
				continue
			}
			wave = append(wave, seed)
		}
		if len(wave) == 0 {
			wave, later = later, nil // a prerequisite no seed makes: each reports it missing
		}
		var group sync.WaitGroup
		earlier := maps.Clone(fixtures)
		for _, seed := range wave {
			group.Go(func() {
				id, warning := seedEntity(ctx, request, seed, earlier)
				mutex.Lock()
				defer mutex.Unlock()
				if warning != "" {
					warnings = append(warnings, warning)
				} else {
					fixtures[seed.fixture] = id
				}
			})
		}
		group.Wait()
		for _, seed := range wave {
			settled[seed.fixture] = true
		}
		pending = later
	}
	delete(fixtures, evaluatorKey)
	return fixtures, warnings
}

// waitsOn reports an entity with a prerequisite not yet settled either way.
func waitsOn(seed entitySeed, settled map[string]bool) bool {
	for _, need := range seed.needs {
		if !settled[need] {
			return true
		}
	}
	return false
}

// seedEntity posts one entity once its wave starts, when its prerequisites were seeded.
func seedEntity(ctx context.Context, request entityRequest, seed entitySeed, fixtures map[string]string) (string, string) {
	if missing := firstMissing(fixtures, seed.needs); missing != "" {
		return "", fmt.Sprintf("%s not seeded: needs %s, which was not", seed.fixture, missing)
	}
	spec := postSpec{url: request.apiURL + seed.path, key: request.key, body: seed.body(fixtures)}
	answer, err := postReading(ctx, request.client, spec)
	if err != nil {
		return "", fmt.Sprintf("%s not seeded: %v", seed.fixture, err)
	}
	id, err := StringAt(answer, seed.idPath)
	if err != nil {
		return "", fmt.Sprintf("%s not seeded: %s answered without %s: %v", seed.fixture, seed.path, seed.idPath, err)
	}
	return id, ""
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

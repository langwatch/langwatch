package visualdiff

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// entityServer answers each REST route the seed posts to, keeping the bodies.
func entityServer(t *testing.T, refuse string) (*httptest.Server, map[string]map[string]any) {
	t.Helper()
	answers := map[string]string{
		"/api/dataset":                 `{"id":"dataset_1"}`,
		"/api/experiments":             `{"id":"experiment_1","slug":"visual-diff-experiment"}`,
		"/api/evaluators":              `{"id":"evaluator_1"}`,
		"/api/monitors":                `{"id":"monitor_1"}`,
		"/api/graphs":                  `{"id":"graph_1"}`,
		"/api/gateway/v1/virtual-keys": `{"virtual_key":{"id":"vk_1"},"secret":"s"}`,
		"/api/gateway/v1/budgets":      `{"budget":{"id":"budget_1"}}`,
		"/api/bug-reports":             `{"id":"bug_1"}`,
	}
	bodies := map[string]map[string]any{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		bodies[r.URL.Path] = body
		if r.URL.Path == refuse {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		_, _ = w.Write([]byte(answers[r.URL.Path]))
	}))
	t.Cleanup(server.Close)
	return server, bodies
}

// @scenario "Each stack seeds the entities its dynamic routes open and keeps its own ids"
func TestEachStackSeedsTheEntitiesItsDynamicRoutesOpenAndKeepsItsOwnIDs(t *testing.T) {
	server, bodies := entityServer(t, "")

	result, err := Seed(context.Background(), SeedRequest{Client: server.Client(), APIURL: server.URL, Identity: SeedIdentity{ProjectKey: DefaultProjectKey}})
	if err != nil {
		t.Fatal(err)
	}

	want := map[string]string{
		FixtureDataset: "dataset_1", FixtureExperiment: "visual-diff-experiment", FixtureMonitor: "monitor_1",
		FixtureGraph: "graph_1", FixtureVirtualKey: "vk_1", FixtureBudget: "budget_1",
		FixtureErrorTrace: SeedErrorTraceID, FixtureConversation: SeedConversationThread, FixtureBugReport: "bug_1",
	}
	if len(result.Warnings) != 0 || len(result.Fixtures) != len(want) {
		t.Fatalf("fixtures %+v, warnings %v", result.Fixtures, result.Warnings)
	}
	for name, id := range want {
		if result.Fixtures[name] != id {
			t.Errorf("%s = %q, want %q", name, result.Fixtures[name], id)
		}
	}
	if bodies["/api/monitors"]["evaluatorId"] != "evaluator_1" {
		t.Errorf("monitor body: %+v", bodies["/api/monitors"])
	}
	scope, _ := bodies["/api/gateway/v1/budgets"]["scope"].(map[string]any)
	if scope["virtual_key_id"] != "vk_1" {
		t.Errorf("budget scope: %+v", scope)
	}
}

// @scenario "An entity a stack refuses is a warning, not a dead run"
func TestAnEntityAStackRefusesIsAWarningNotADeadRun(t *testing.T) {
	server, _ := entityServer(t, "/api/evaluators")

	result, err := Seed(context.Background(), SeedRequest{Client: server.Client(), APIURL: server.URL, Identity: SeedIdentity{ProjectKey: DefaultProjectKey}})
	if err != nil {
		t.Fatal(err)
	}

	if _, ok := result.Fixtures[FixtureMonitor]; ok || result.Fixtures[FixtureGraph] != "graph_1" {
		t.Fatalf("fixtures: %+v", result.Fixtures)
	}
	joined := strings.Join(result.Warnings, "\n")
	mustContain(t, joined, "evaluator not seeded")
	mustContain(t, joined, "monitor not seeded: needs evaluator")
}

func TestStringAtReadsANestedID(t *testing.T) {
	if id, err := StringAt([]byte(`{"virtual_key":{"id":"vk"}}`), "virtual_key.id"); err != nil || id != "vk" {
		t.Fatalf("got %q, %v", id, err)
	}
	for _, body := range []string{`{"id":""}`, `{"id":3}`, `[]`, `not json`} {
		if _, err := StringAt([]byte(body), "id"); err == nil {
			t.Errorf("%s read as an id", body)
		}
	}
}

// @scenario "A side renders the ids its own seed generated, and a resumed run keeps them"
func TestASideRendersTheIDsItsOwnSeedGeneratedAndAResumedRunKeepsThem(t *testing.T) {
	fake := &fakeRunner{}
	var handed RunnerPlan
	deps := passingDeps(fake, nil, nil)
	deps.Seed = func(context.Context, SeedRequest) (SeedResult, error) {
		return SeedResult{Fixtures: map[string]string{FixtureDataset: "dataset_1"}}, nil
	}
	deps.Capture = func(_ context.Context, plan RunnerPlan, _ CaptureOptions) (RunnerStream, error) {
		handed = plan
		return RunnerStream{}, nil
	}
	options := testOptions(t)

	if _, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: &bytes.Buffer{}, Err: &bytes.Buffer{}}); err != nil {
		t.Fatal(err)
	}

	for _, side := range handed.Sides {
		if side.Fixtures[FixtureDataset] != "dataset_1" {
			t.Errorf("a shared database gives %s the candidate's ids: %+v", side.Name, side.Fixtures)
		}
	}
	recorded, err := os.ReadFile(filepath.Join(options.RunDir, "seeded"))
	if err != nil {
		t.Fatal(err)
	}
	if ReadSeededMarker(recorded)["candidate"][FixtureDataset] != "dataset_1" {
		t.Fatalf("marker: %s", recorded)
	}
	if len(ReadSeededMarker(nil)) != 0 {
		t.Fatal("an older run's empty marker reads as no fixtures")
	}
}

func TestASeededPlaceholderNeedsNoStaticFixture(t *testing.T) {
	config := &Config{Routes: []string{"/{slug}/datasets/{dataset}"}}
	if err := config.Validate(); err != nil {
		t.Fatal(err)
	}
}

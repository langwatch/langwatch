package visualdiff

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// catalogueServer answers the catalogue's writes and keeps each call's path and body.
func catalogueServer(t *testing.T) (*httptest.Server, func() map[string][]map[string]any) {
	t.Helper()
	calls := map[string][]map[string]any{}
	var mutex sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		mutex.Lock()
		defer mutex.Unlock()
		calls[r.URL.Path] = append(calls[r.URL.Path], body)
		switch {
		case r.URL.Path == "/api/dashboards" || r.URL.Path == "/api/workflows":
			_, _ = w.Write([]byte(`{"data":[]}`))
		case r.URL.Path == "/api/trpc/annotationScore.getAll":
			_, _ = w.Write([]byte(`{"result":{"data":[]}}`))
		case r.URL.Path == "/api/trpc/departments.list":
			_, _ = w.Write([]byte(`{"result":{"data":[]}}`))
		case r.URL.Path == "/api/trpc/departments.create":
			_, _ = w.Write([]byte(`{"result":{"data":{"id":"dept_1","name":"Engineering"}}}`))
		default:
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	t.Cleanup(server.Close)
	return server, func() map[string][]map[string]any {
		mutex.Lock()
		defer mutex.Unlock()
		return calls
	}
}

// @scenario "Each stack seeds a lived-in catalogue: named dashboards, icon workflows, agents and a department"
func TestTheCatalogueSeedNamesItsDashboardsAndPutsTheAdminInADepartment(t *testing.T) {
	server, read := catalogueServer(t)

	warnings := seedCatalogue(t.Context(), catalogueRequest{
		client: server.Client(), apiURL: server.URL, key: DefaultProjectKey,
		identity: SeedIdentity{Email: SeededEmail, Password: SeededPassword},
	})

	if len(warnings) != 0 {
		t.Fatalf("warnings: %v", warnings)
	}
	calls := read()
	if len(calls["/api/dashboards"]) != 1+len(seedDashboardNames) {
		t.Errorf("dashboard calls: %+v", calls["/api/dashboards"])
	}
	if len(calls["/api/trpc/workflow.create"]) != len(seedWorkflows) {
		t.Errorf("workflow creates: %+v", calls["/api/trpc/workflow.create"])
	}
	dsl, _ := calls["/api/trpc/workflow.create"][0]["dsl"].(map[string]any)
	if icon, _ := dsl["icon"].(string); icon == "" {
		t.Errorf("a seeded workflow has no icon: %+v", dsl)
	}
	assigned := calls["/api/trpc/departments.assignUser"]
	if len(assigned) != 1 || assigned[0]["departmentId"] != "dept_1" || assigned[0]["userId"] != seededAdminUserID {
		t.Errorf("department assignment: %+v", assigned)
	}
	if len(calls["/api/v1/agents/connect/register"]) != 2 {
		t.Errorf("registrations: %+v", calls["/api/v1/agents/connect/register"])
	}
}

// @scenario "Each stack offers the Langy echo model and one annotation score metric"
func TestTheCatalogueSeedOffersTheLangyModelAndAScoreMetric(t *testing.T) {
	server, read := catalogueServer(t)

	warnings := seedCatalogue(t.Context(), catalogueRequest{
		client: server.Client(), apiURL: server.URL, key: DefaultProjectKey,
		identity: SeedIdentity{Email: SeededEmail, Password: SeededPassword},
	})

	if len(warnings) != 0 {
		t.Fatalf("warnings: %v", warnings)
	}
	calls := read()
	models, _ := calls["/api/model-providers/openai"][0]["customModels"].([]any)
	if len(models) != 1 || models[0] != SeedLangyModel {
		t.Errorf("provider write: %+v", calls["/api/model-providers/openai"])
	}
	if _, keyed := calls["/api/model-providers/openai"][0]["customKeys"]; keyed {
		t.Errorf("the provider write replaces the process's credentials: %+v", calls["/api/model-providers/openai"])
	}
	scores := calls["/api/trpc/annotationScore.upsert"]
	if len(scores) != 1 || scores[0]["name"] != SeedAnnotationScoreName {
		t.Errorf("score upserts: %+v", scores)
	}
}

func TestNamedIDsReadsAListInAnyWrapper(t *testing.T) {
	for _, body := range []string{
		`[{"id":"a","name":"Engineering"}]`,
		`{"data":[{"id":"a","name":"Engineering"}]}`,
		`{"result":{"data":{"json":[{"id":"a","name":"Engineering"}]}}}`,
	} {
		if got := namedIDs([]byte(body))["Engineering"]; got != "a" {
			t.Errorf("%s read %q", body, got)
		}
	}
	if len(namedIDs([]byte(`not json`))) != 0 {
		t.Error("a bad body read as a list")
	}
}

func TestARefusedRegistrationIsAnError(t *testing.T) {
	if err := refusedRegistration([]byte(`{"frame":{"type":"refused","code":"api_key_invalid","message":"no"}}`)); err == nil {
		t.Error("a refusal read as registered")
	}
	if err := refusedRegistration([]byte(`{"frame":{"type":"registered"}}`)); err != nil {
		t.Errorf("a registration read as refused: %v", err)
	}
}

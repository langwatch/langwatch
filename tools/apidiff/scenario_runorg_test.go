package apidiff

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// recordingStack answers the two seeding routes and remembers who called them.
type recordingStack struct {
	mutex   sync.Mutex
	bearers map[string][]string
}

func (stack *recordingStack) handler() http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet && request.URL.Path == "/api/organizations" {
			return
		}
		stack.mutex.Lock()
		stack.bearers[request.URL.Path] = append(stack.bearers[request.URL.Path], request.Header.Get("Authorization"))
		stack.mutex.Unlock()
		writer.WriteHeader(http.StatusCreated)
		if request.URL.Path == "/api/organizations" {
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"organization": map[string]any{"id": "org_run"}, "team": map[string]any{"id": "team_run"},
				"adminApiKey": map[string]any{"token": "run-org-key"},
			})
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"id": "project_run", "serviceApiKey": "run-project-key", "teamId": "team_run"})
	})
}

func TestProjectShardsLiveInTheRunOrganizationNotTheSeededOne(t *testing.T) {
	stack := &recordingStack{bearers: map[string][]string{}}
	server := httptest.NewServer(stack.handler())
	t.Cleanup(server.Close)
	options := scenarioOptions{A: server.URL, Keys: Keys{OrgKey: "seeded-org-key", AdminKey: "admin"}, Concurrency: 2, Shards: 2}
	runner := newScenarioRunner(t.Context(), options)
	runner.seed(scenarioNeeds{projects: 2})
	for _, shard := range runner.sides[0].projects {
		if shard.err != "" || shard.vars["orgId"] != "org_run" || shard.vars["orgKey"] != "run-org-key" || shard.keys.OrgKey != "run-org-key" {
			t.Errorf("shard is not in the run organization: %+v", shard)
		}
		if shard.vars["orgId"] == seededOrganizationID {
			t.Errorf("shard names the seeded organization")
		}
	}
	for path, bearers := range stack.bearers {
		for _, bearer := range bearers {
			if bearer == "Bearer seeded-org-key" {
				t.Errorf("%s was called with the seeded organization's key", path)
			}
		}
	}
	if created := len(stack.bearers["/api/organizations"]); created != 1 {
		t.Errorf("%d organizations made, want the one run organization", created)
	}
}

func TestProjectShardsFallBackToTheSeededOrganizationWithoutTheAdminKey(t *testing.T) {
	stack := &recordingStack{bearers: map[string][]string{}}
	server := httptest.NewServer(stack.handler())
	t.Cleanup(server.Close)
	runner := newScenarioRunner(t.Context(), scenarioOptions{A: server.URL, Keys: Keys{OrgKey: "seeded-org-key"}, Concurrency: 2, Shards: 1})
	runner.seed(scenarioNeeds{projects: 1})
	if len(stack.bearers["/api/organizations"]) != 0 || stack.bearers["/api/projects"][0] != "Bearer seeded-org-key" {
		t.Errorf("without the admin key the seeded organization is used: %v", stack.bearers)
	}
}

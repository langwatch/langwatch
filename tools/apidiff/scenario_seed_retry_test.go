package apidiff

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestSeedProjectRetriesAnUnansweredCreate(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if calls.Add(1) == 1 {
			connection, _, err := writer.(http.Hijacker).Hijack()
			if err == nil {
				_ = connection.Close()
			}
			return
		}
		writer.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(writer).Encode(map[string]any{"id": "p1", "serviceApiKey": "k1", "teamId": "t1"})
	}))
	t.Cleanup(server.Close)
	runner := newScenarioRunner(t.Context(), scenarioOptions{A: server.URL, Keys: Keys{OrgKey: "org"}, Concurrency: 1, Shards: 1})
	runner.seed(scenarioNeeds{projects: 1})
	shard := runner.sides[0].projects[0]
	if shard.err != "" || shard.vars["projectId"] != "p1" || calls.Load() != 2 {
		t.Fatalf("want one retry then a project, got calls=%d shard=%+v", calls.Load(), shard)
	}
}

package apidiff

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func readScenarios(count int, shard string) string {
	var yaml strings.Builder
	for index := range count {
		fmt.Fprintf(&yaml, "- id: probe-%d\n  endpoint: GET /api/dataset\n  shard: %s\n  request: { path: /api/dataset }\n  expect: { status: 200 }\n", index, shard)
	}
	return yaml.String()
}

func runPhase(t *testing.T, baseURL string, options scenarioOptions, count int, shard string) (int, string) {
	t.Helper()
	options.A, options.Timeout, options.Concurrency, options.Shards = baseURL, 2*time.Second, 1, 1
	options.Glob, options.RunDir = writeScenarioYAML(t, readScenarios(count, shard)), t.TempDir()
	if options.Keys == (Keys{}) {
		options.Keys = Keys{ProjectKey: "key", OrgKey: "org"}
	}
	var report bytes.Buffer
	code := runScenarioPhase(context.Background(), options, &report, &report)
	return code, report.String()
}

func deadURL(t *testing.T) string {
	t.Helper()
	server := httptest.NewServer(http.NotFoundHandler())
	server.Close()
	return server.URL
}

func TestAStreakOfHarnessErrorsStopsTheRunAtN(t *testing.T) {
	options := scenarioOptions{MaxErrors: 3}
	code, report := runPhase(t, deadURL(t), options, 12, shardShared)
	if code != exitStopped || !strings.Contains(report, "apidiff: stopping: 3 consecutive errors, most common cause:") {
		t.Fatalf("code %d:\n%s", code, report)
	}
	if !strings.Contains(report, "scenarios: 9 of 12 not run") {
		t.Errorf("the rest were not dropped:\n%s", report)
	}
}

func TestZeroDisablesTheStreakRule(t *testing.T) {
	code, report := runPhase(t, deadURL(t), scenarioOptions{}, 12, shardShared)
	if code != exitError || strings.Contains(report, "stopping") || !strings.Contains(report, "scenarios: 12 run: ") {
		t.Fatalf("code %d:\n%s", code, report)
	}
}

func TestFailedExpectationsAreNotErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusInternalServerError) }))
	t.Cleanup(server.Close)
	code, report := runPhase(t, server.URL, scenarioOptions{MaxErrors: 2}, 8, shardShared)
	if code != exitDifferences || strings.Contains(report, "stopping") || !strings.Contains(report, "8 FAIL") {
		t.Fatalf("code %d:\n%s", code, report)
	}
}

func TestAFailBetweenErrorsNeitherCountsNorResets(t *testing.T) {
	runner := newScenarioRunner(context.Background(), scenarioOptions{MaxErrors: 3})
	for _, verdict := range []string{verdictError, verdictFail, verdictError, verdictFailBranch} {
		runner.settle(&scenarioResult{Verdict: verdict, FirstFail: "refused"})
	}
	if runner.stopped.Load() {
		t.Fatal("stopped before the third error")
	}
	runner.settle(&scenarioResult{Verdict: verdictError, FirstFail: "refused"})
	if !runner.stopped.Load() {
		t.Fatal("did not stop on the third error")
	}
	runner = newScenarioRunner(context.Background(), scenarioOptions{MaxErrors: 3})
	for _, verdict := range []string{verdictError, verdictError, verdictPass, verdictError} {
		runner.settle(&scenarioResult{Verdict: verdict, FirstFail: "refused"})
	}
	if runner.stopped.Load() {
		t.Fatal("a PASS did not reset the streak")
	}
}

func TestARefusedRunOrganizationStopsBeforeAnyScenario(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusInternalServerError) }))
	t.Cleanup(server.Close)
	options := scenarioOptions{MaxErrors: 50, Keys: Keys{ProjectKey: "key", OrgKey: "org", AdminKey: "admin"}}
	code, report := runPhase(t, server.URL, options, 5, shardProject)
	if code != exitError || !strings.Contains(report, "apidiff: stopping: setup failed: stack: seed organization: status 500") {
		t.Fatalf("code %d:\n%s", code, report)
	}
	if strings.Contains(report, "scenarios: 5 run") {
		t.Errorf("scenarios ran after a failed setup:\n%s", report)
	}
}

func TestWithoutTheAdminKeyTheSeededOrganizationStaysUsable(t *testing.T) {
	stack := &recordingStack{bearers: map[string][]string{}}
	server := httptest.NewServer(stack.handler())
	t.Cleanup(server.Close)
	runner := newScenarioRunner(context.Background(), scenarioOptions{A: server.URL, Keys: Keys{OrgKey: "seeded"}, Concurrency: 1, Shards: 1})
	needs := scenarioNeeds{projects: 1}
	runner.seed(needs)
	if cause := runner.setupFailure(needs); cause != "" {
		t.Fatalf("the fallback to the seeded organization was refused: %s", cause)
	}
}

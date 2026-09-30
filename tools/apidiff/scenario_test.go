package apidiff

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func writeScenarioYAML(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "area.yaml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoaderNamesTheFileAndTheScenario(t *testing.T) {
	path := writeScenarioYAML(t, `
- id: Bad_ID
  endpoint: nonsense
  auth: wizard
  shard: everywhere
  request: { path: /api/x }
- id: fine-one
  endpoint: GET /api/x
  request: { path: /api/x }
  expect: { status: 200 }
  verify:
    - request: GET /api/y
`)
	_, err := loadScenarioFile(path)
	if err == nil {
		t.Fatal("expected problems")
	}
	for _, want := range []string{path + `: scenario "Bad_ID": id must be kebab-case`, `endpoint "nonsense"`, `auth "wizard"`, `shard "everywhere"`, "expect.status is required", `scenario "fine-one": verify[0]: a verify request needs expect.status`} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error lacks %q:\n%s", want, err)
		}
	}
}

func TestLoaderRejectsUnknownKeysAndDuplicateIDs(t *testing.T) {
	if _, err := loadScenarioFile(writeScenarioYAML(t, "- id: a-b\n  endpoint: GET /x\n  bogus: 1\n")); err == nil || !strings.Contains(err.Error(), "bogus") {
		t.Errorf("unknown key: %v", err)
	}
	dir := t.TempDir()
	body := "- id: same\n  endpoint: GET /x\n  request: { path: /x }\n  expect: { status: 200 }\n"
	for _, name := range []string{"a.yaml", "b.yaml"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := loadScenarios(filepath.Join(dir, "*.yaml")); err == nil || !strings.Contains(err.Error(), "id already used") {
		t.Errorf("duplicate id: %v", err)
	}
}

func TestMatchBodyIsASubsetWithDottedPaths(t *testing.T) {
	got := map[string]any{"data": []any{map[string]any{"id": "x", "n": float64(2)}}, "a": map[string]any{"b": "c"}, "gone": nil}
	holds := []any{
		map[string]any{"a.b": "c"},
		map[string]any{"data": []any{map[string]any{"n": 2}}},
		map[string]any{"a": map[string]any{"b": scenarioAny}},
	}
	for _, want := range holds {
		if detail := matchBody(want, got, ""); detail != "" {
			t.Errorf("%v: %s", want, detail)
		}
	}
	fails := []any{map[string]any{"a.b": "d"}, map[string]any{"missing": 1}, map[string]any{"gone": scenarioAny}, map[string]any{"data": []any{1, 2}}}
	for _, want := range fails {
		if matchBody(want, got, "") == "" {
			t.Errorf("%v should not match", want)
		}
	}
}

func TestExpandTextRefusesAnUnknownPlaceholder(t *testing.T) {
	if _, err := expandText("a-{nope}", map[string]string{"uid": "1"}); err == nil {
		t.Error("expected an error")
	}
	if got, _ := expandText(`{ "x": {uid} }`, map[string]string{"uid": "7"}); got != `{ "x": 7 }` {
		t.Errorf("got %q", got)
	}
}

// fakeStack is the slice of the API and the mail sink the scenarios below use.
type fakeStack struct {
	mu       sync.Mutex
	datasets map[string][]string
	created  int
	projects int
	orgs     int
	badCode  int
}

func (stack *fakeStack) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/dataset", stack.createDataset)
	mux.HandleFunc("/api/dataset/", stack.dataset)
	mux.HandleFunc("/api/projects", func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet {
			replyJSON(writer, http.StatusOK, map[string]any{"data": []string{}})
			return
		}
		stack.mu.Lock()
		stack.projects++
		number := stack.projects
		stack.mu.Unlock()
		replyJSON(writer, http.StatusCreated, map[string]any{"id": fmt.Sprintf("p%d", number), "serviceApiKey": fmt.Sprintf("k%d", number)})
	})
	mux.HandleFunc("/api/organizations", func(writer http.ResponseWriter, _ *http.Request) {
		stack.mu.Lock()
		stack.orgs++
		number := stack.orgs
		stack.mu.Unlock()
		replyJSON(writer, http.StatusCreated, map[string]any{
			"organization": map[string]any{"id": fmt.Sprintf("o%d", number)}, "team": map[string]any{"id": fmt.Sprintf("t%d", number)},
			"adminApiKey": map[string]any{"token": fmt.Sprintf("ok%d", number)},
		})
	})
	mux.HandleFunc("/api/echo", func(writer http.ResponseWriter, request *http.Request) {
		replyJSON(writer, http.StatusOK, map[string]any{"token": request.Header.Get("X-Auth-Token"), "bearer": request.Header.Get("Authorization")})
	})
	mux.HandleFunc("/api/messages", func(writer http.ResponseWriter, request *http.Request) {
		messages := []any{}
		if request.URL.Query().Get("to") == "known@example.com" {
			messages = append(messages, map[string]any{"id": "m1"})
		}
		replyJSON(writer, http.StatusOK, map[string]any{"messages": messages})
	})
	return mux
}

func replyJSON(writer http.ResponseWriter, status int, body any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(body)
}

func (stack *fakeStack) createDataset(writer http.ResponseWriter, request *http.Request) {
	if request.Header.Get("X-Auth-Token") == "" {
		replyJSON(writer, http.StatusUnauthorized, map[string]any{"error": "no key"})
		return
	}
	if request.Method == http.MethodGet {
		replyJSON(writer, http.StatusOK, map[string]any{"data": []string{}})
		return
	}
	var input struct{ Name string }
	_ = json.NewDecoder(request.Body).Decode(&input)
	if input.Name == "" {
		replyJSON(writer, http.StatusUnprocessableEntity, map[string]any{"error": "name"})
		return
	}
	stack.mu.Lock()
	defer stack.mu.Unlock()
	stack.created++
	id := fmt.Sprintf("d%d", stack.created)
	stack.datasets[id] = []string{}
	status := http.StatusCreated
	if stack.badCode != 0 {
		status = stack.badCode
	}
	replyJSON(writer, status, map[string]any{"id": id, "name": input.Name})
}

func (stack *fakeStack) dataset(writer http.ResponseWriter, request *http.Request) {
	parts := strings.Split(strings.TrimPrefix(request.URL.Path, "/api/dataset/"), "/")
	stack.mu.Lock()
	defer stack.mu.Unlock()
	records, ok := stack.datasets[parts[0]]
	if !ok {
		replyJSON(writer, http.StatusNotFound, map[string]any{"error": "gone"})
		return
	}
	if len(parts) == 2 {
		stack.datasets[parts[0]] = append(records, "one", "two")
		replyJSON(writer, http.StatusCreated, map[string]any{"data": []string{"one", "two"}})
		return
	}
	replyJSON(writer, http.StatusOK, map[string]any{"id": parts[0], "data": stack.datasets[parts[0]]})
}

const fakeScenarios = `
- id: create-is-readable
  endpoint: POST /api/dataset
  request: { path: /api/dataset, body: { name: "vd-{uid}" } }
  capture: { datasetId: id }
  expect: { status: 201, body: { name: "vd-{uid}", id: "<any>" } }
  verify:
    - request: GET /api/dataset/{datasetId}
      eventually: 2s
      expect: { status: 200 }
- id: create-rejects-missing-name
  endpoint: POST /api/dataset
  request: { path: /api/dataset, body: {} }
  expect: { status: [400, 422] }
- id: records-count-delta
  endpoint: POST /api/dataset/{id}/records
  shard: project
  setup:
    - request: POST /api/dataset
      body: { name: "vd-{uid}" }
      capture: { datasetId: id }
  request: { path: "/api/dataset/{datasetId}/records", body: { entries: [{}] } }
  expect: { status: 201, path: data, length: 2 }
  verify:
    - countDelta: { request: "GET /api/dataset/{datasetId}", path: data, by: 2 }
  serial-note: unused
`

func runFake(t *testing.T, branch, main *fakeStack, yaml string, repeat int) (int, string, []scenarioResult) {
	t.Helper()
	serverA, serverB := httptest.NewServer(branch.handler()), httptest.NewServer(main.handler())
	t.Cleanup(serverA.Close)
	t.Cleanup(serverB.Close)
	path := writeScenarioYAML(t, strings.Replace(yaml, "  serial-note: unused\n", "", 1))
	options := scenarioOptions{
		A: serverA.URL, B: serverB.URL, MailA: serverA.URL, MailB: serverB.URL,
		Keys: Keys{ProjectKey: "key", OrgKey: "org"}, Timeout: 5 * time.Second,
		Concurrency: 4, Shards: 2, Repeat: repeat, Glob: path, RunDir: t.TempDir(),
	}
	var report bytes.Buffer
	code := runScenarioPhase(context.Background(), options, &report, &report)
	if _, err := os.Stat(filepath.Join(options.RunDir, "scenarios.jsonl")); err != nil {
		t.Fatalf("the phase wrote no results (exit %d):\n%s", code, report.String())
	}
	return code, report.String(), readResults(t, options.RunDir)
}

func readResults(t *testing.T, dir string) []scenarioResult {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, "scenarios.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var results []scenarioResult
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		var result scenarioResult
		if err := json.Unmarshal([]byte(line), &result); err != nil {
			t.Fatal(err)
		}
		results = append(results, result)
	}
	return results
}

func newFake() *fakeStack { return &fakeStack{datasets: map[string][]string{}} }

func TestScenarioPhasePassesWhenBothSidesHold(t *testing.T) {
	code, report, results := runFake(t, newFake(), newFake(), fakeScenarios, 1)
	if code != exitEqual || len(results) != 3 {
		t.Fatalf("code %d, %d results:\n%s", code, len(results), report)
	}
	for _, result := range results {
		if result.Verdict != verdictPass {
			t.Errorf("%s: %s %s", result.ID, result.Verdict, result.FirstFail)
		}
	}
	if !strings.Contains(report, "3 PASS") || !strings.Contains(report, "scenarios/s") {
		t.Errorf("report lacks the tally or the timing block:\n%s", report)
	}
}

func TestScenarioPhaseNamesTheFailingSide(t *testing.T) {
	branch := newFake()
	branch.badCode = http.StatusOK
	code, report, results := runFake(t, branch, newFake(), fakeScenarios, 1)
	if code != exitDifferences {
		t.Fatalf("code %d:\n%s", code, report)
	}
	if results[0].Verdict != verdictFailBranch || !strings.Contains(results[0].FirstFail, "status 200, expected 201") {
		t.Errorf("first scenario: %s %q", results[0].Verdict, results[0].FirstFail)
	}
	if !strings.Contains(report, "FAIL-branch") || !strings.Contains(report, "first failing step") {
		t.Errorf("report:\n%s", report)
	}
}

func TestScenarioPhaseCountsRepeatsAndFiltersByID(t *testing.T) {
	_, _, results := runFake(t, newFake(), newFake(), fakeScenarios, 5)
	if len(results) != 15 {
		t.Errorf("%d results, want 15", len(results))
	}
	if kept := selectScenarios([]scenario{{ID: "a-one"}, {ID: "b-two"}}, []string{"a-*"}); len(kept) != 1 {
		t.Errorf("filter kept %d", len(kept))
	}
}

func TestMailStepWaitsForTheSink(t *testing.T) {
	yaml := `
- id: mail-arrives
  endpoint: POST /api/dataset
  request: { path: /api/dataset, body: { name: "vd-{uid}" } }
  expect: { status: 201 }
  verify:
    - mail: { to: known@example.com }
- id: mail-absent
  endpoint: POST /api/dataset
  request: { path: /api/dataset, body: { name: "vd-{uid}" } }
  expect: { status: 201 }
  verify:
    - mail: { to: other@example.com, absent: true }
- id: mail-missing
  endpoint: POST /api/dataset
  request: { path: /api/dataset, body: { name: "vd-{uid}" } }
  expect: { status: 201 }
  verify:
    - mail: { to: other@example.com }
`
	_, _, results := runFake(t, newFake(), newFake(), yaml, 1)
	want := map[string]string{"mail-arrives": verdictPass, "mail-absent": verdictPass, "mail-missing": verdictFailBoth}
	for _, result := range results {
		if result.Verdict != want[result.ID] {
			t.Errorf("%s: %s %s", result.ID, result.Verdict, result.FirstFail)
		}
	}
}

func TestScenarioPhaseHoldsAtVolume(t *testing.T) {
	code, report, results := runFake(t, newFake(), newFake(), fakeScenarios, 200)
	if code != exitEqual || len(results) != 600 {
		t.Fatalf("code %d, %d results:\n%s", code, len(results), report)
	}
	for _, line := range strings.Split(report, "\n") {
		if strings.HasPrefix(line, "timing: wall") {
			t.Log(line)
		}
	}
}

func TestAWholeNowMsPlaceholderExpandsToANumber(t *testing.T) {
	value, err := expandValue(map[string]any{"at": "{nowMs-1000}", "label": "at {nowMs}"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	fields := value.(map[string]any)
	if _, ok := fields["at"].(int64); !ok {
		t.Fatalf("at = %#v, want an int64", fields["at"])
	}
	if _, ok := fields["label"].(string); !ok {
		t.Fatalf("label = %#v, want a string", fields["label"])
	}
}

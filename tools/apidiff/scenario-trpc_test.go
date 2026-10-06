package apidiff

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

func TestWrapTRPCBodyFollowsTheSidesTransformer(t *testing.T) {
	input := map[string]any{"a": "b"}
	if got := wrapTRPCBody(trpcNone, input); !reflect.DeepEqual(got, input) {
		t.Errorf("none: got %v", got)
	}
	if got := wrapTRPCBody(trpcSuperjson, input); !reflect.DeepEqual(got, map[string]any{"json": input}) {
		t.Errorf("superjson: got %v", got)
	}
}

func TestUnwrapTRPCDataLiftsOnlyASuperjsonAnswer(t *testing.T) {
	wrapped, _ := decodeJSONBody(`{"result":{"data":{"json":{"id":"w1"}}}}`)
	if id, ok := lookupPath(unwrapTRPCData(trpcSuperjson, wrapped), "result.data.id"); !ok || id != "w1" {
		t.Errorf("superjson answer not lifted: %v %v", id, ok)
	}
	plain, _ := decodeJSONBody(`{"result":{"data":{"json":{"id":"w1"}}}}`)
	if _, ok := lookupPath(unwrapTRPCData(trpcNone, plain), "result.data.id"); ok {
		t.Error("a plain side's own json field was lifted")
	}
}

const trpcScenarios = `
- id: trpc-neutral-setup
  endpoint: GET /api/workflows/{id}
  serial: true
  setup:
    - request: POST /api/trpc/workflow.create
      body: { name: "wf-{uid}" }
      capture: { wfId: "result.data.workflow.id" }
      expect: { status: 200 }
  request: { path: "/api/workflows/{wfId}" }
  expect: { status: 200 }
`

func trpcSide(t *testing.T, superjson bool) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/trpc/workflow.create" {
			replyJSON(writer, http.StatusOK, map[string]any{})
			return
		}
		var body map[string]any
		_ = json.NewDecoder(request.Body).Decode(&body)
		_, wrapped := body["json"]
		if wrapped != superjson {
			replyJSON(writer, http.StatusBadRequest, map[string]any{})
			return
		}
		data := map[string]any{"workflow": map[string]any{"id": "w1"}}
		if superjson {
			data = map[string]any{"json": data}
		}
		replyJSON(writer, http.StatusOK, map[string]any{"result": map[string]any{"data": data}})
	}))
	t.Cleanup(server.Close)
	return server
}

func TestScenarioSetupWritesOneBodyForBothTransformers(t *testing.T) {
	branch, main := trpcSide(t, false), trpcSide(t, true)
	options := scenarioOptions{
		A: branch.URL, B: main.URL, Keys: Keys{ProjectKey: "key", OrgKey: "org"}, Timeout: 5 * time.Second,
		Concurrency: 2, Shards: 1, Glob: writeScenarioYAML(t, trpcScenarios), RunDir: t.TempDir(),
	}
	var report bytes.Buffer
	if code := runScenarioPhase(context.Background(), scenarioPhase{options: options, report: &report, progress: &report}); code != exitEqual {
		t.Fatalf("exit %d:\n%s", code, report.String())
	}
	for _, result := range readResults(t, options.RunDir) {
		if result.Verdict != verdictPass {
			t.Errorf("%s: %s %s", result.ID, result.Verdict, result.FirstFail)
		}
	}
}

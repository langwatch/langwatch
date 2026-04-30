// Integration test for execute_evaluation: drives the SSE endpoint
// with a multi-row dataset, asserts the per-entry evaluation_state_change
// progress events land on the wire, AND asserts a final batch POST
// hits /api/evaluations/batch/log_results carrying the dataset rows +
// evaluator results that Studio's experiment-runs page renders from.
//
// rchaves dogfood 2026-04-29 (workflow_qtBZcCf4ch5xfxBm-NIZL): the
// "Evaluate" button kicked an SSE flow that returned cleanly but the
// experiment-runs page never populated. This test pins the missing
// piece — without the batch POST, the UI stays at "Waiting for
// evaluation results" forever.
package integration_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/agentblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/evaluatorblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)

// recordedRequest captures one inbound HTTP call against the fake
// LangWatch app. We assert specifically on /api/evaluations/batch/
// log_results — that's the call missing pre-fix.
type recordedRequest struct {
	path    string
	method  string
	headers http.Header
	body    map[string]any
}

func setupEvaluationStack(t *testing.T) (string, *[]recordedRequest, *sync.Mutex) {
	t.Helper()
	mu := &sync.Mutex{}
	var captured []recordedRequest

	lwSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bodyBytes, _ := io.ReadAll(r.Body)
		var parsed map[string]any
		_ = json.Unmarshal(bodyBytes, &parsed)
		mu.Lock()
		captured = append(captured, recordedRequest{
			path:    r.URL.Path,
			method:  r.Method,
			headers: r.Header.Clone(),
			body:    parsed,
		})
		mu.Unlock()
		// Mirror the legacy evaluator endpoint shape — both
		// /api/evaluations/.../evaluate and /api/evaluations/batch/
		// log_results return 200 with a JSON body.
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/evaluate"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":  "processed",
				"score":   1.0,
				"passed":  true,
				"details": "ok",
			})
		case r.URL.Path == "/api/evaluations/batch/log_results":
			_ = json.NewEncoder(w).Encode(map[string]any{"message": "ok"})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{})
		}
	}))
	t.Cleanup(lwSrv.Close)

	httpExec := httpblock.New(httpblock.Options{})
	codeExec, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)
	evalExec := evaluatorblock.New(evaluatorblock.Options{})
	agentRunner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{})

	eng := engine.New(engine.Options{
		HTTP:             httpExec,
		Code:             codeExec,
		Evaluator:        evalExec,
		AgentWorkflow:    agentRunner,
		LangWatchBaseURL: lwSrv.URL,
	})

	application := app.New(app.WithWorkflowExecutor(executorAdapter{eng: eng}))
	probes := health.New("test")
	probes.MarkStarted()
	router := httpapi.NewRouter(httpapi.RouterDeps{
		App:     application,
		Health:  probes,
		Version: "test",
	})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return srv.URL, &captured, mu
}

// TestEvaluationWorkflow_PostsBatchResultsToLangWatch is the load-bearing
// test for bug E. Builds a 2-row evaluation workflow (entry → evaluator
// → end), kicks an execute_evaluation SSE run, and asserts:
//  1. The wire emits per-entry evaluation_state_change progress events
//     so Studio's evaluation reducer can flip the running spinner.
//  2. A POST lands on /api/evaluations/batch/log_results with the run_id,
//     experiment_slug, all dataset rows, all evaluator results, and a
//     finished_at timestamp — the wire shape Studio's experiment-runs
//     page renders from.
//
// Pre-fix: the SSE frames landed cleanly but the batch POST never
// happened, so the experiment-runs page stayed empty even after a
// successful eval.
func TestEvaluationWorkflow_PostsBatchResultsToLangWatch(t *testing.T) {
	url, captured, mu := setupEvaluationStack(t)

	envelope := `{
	  "type": "execute_evaluation",
	  "payload": {
	    "trace_id": "trace_eval_1",
	    "run_id": "run_eval_1",
	    "workflow_version_id": "wfv_1",
	    "evaluate_on": "full",
	    "origin": "evaluation",
	    "workflow": {
	      "workflow_id": "wf_eval",
	      "api_key": "sk-token",
	      "spec_version": "1.3",
	      "name": "Eval Demo",
	      "icon": "x",
	      "description": "x",
	      "version": "x",
	      "template_adapter": "default",
	      "nodes": [
	        {"id":"entry","type":"entry","data":{
	          "outputs":[
	            {"identifier":"input","type":"str"},
	            {"identifier":"output","type":"str"}
	          ],
	          "dataset":{"inline":{"records":{"input":["hello","world"],"output":["hello","world"]}}},
	          "train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"eval","type":"evaluator","data":{
	          "evaluator":"langevals/exact_match"
	        }},
	        {"id":"end","type":"end","data":{}}
	      ],
	      "edges": [
	        {"id":"e1","source":"entry","sourceHandle":"outputs.input","target":"eval","targetHandle":"inputs.input","type":"default"},
	        {"id":"e2","source":"entry","sourceHandle":"outputs.output","target":"eval","targetHandle":"inputs.output","type":"default"},
	        {"id":"e3","source":"eval","sourceHandle":"any","target":"end","targetHandle":"any","type":"default"}
	      ],
	      "state": {}
	    }
	  }
	}`

	req, err := http.NewRequest("POST", url+"/go/studio/execute", bytes.NewBufferString(envelope))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-LangWatch-Origin", "evaluation")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Header.Get("Content-Type"), "text/event-stream")

	frames := readSSE(t, resp.Body, func(f streamFrame) bool { return f.Event == "done" })

	// Wire-shape check: at least the running event, two progress events
	// (one per dataset row), and a final success event must reach the
	// reducer. Studio's reducer keys evaluations on workflow.state.
	// evaluation.run_id — the run_id stamped on these payloads is what
	// connects the streamed updates to the run dispatched by Studio.
	progressByStatus := map[string]int{}
	var sawSuccess bool
	for _, f := range frames {
		if f.Event != "evaluation_state_change" {
			continue
		}
		es, _ := f.Data["evaluation_state"].(map[string]any)
		status, _ := es["status"].(string)
		progressByStatus[status]++
		assert.Equal(t, "run_eval_1", es["run_id"], "evaluation_state_change must carry the run_id")
		if status == "success" {
			sawSuccess = true
		}
	}
	assert.GreaterOrEqual(t, progressByStatus["running"], 2,
		"must emit at least one running event per dataset entry (got %d)", progressByStatus["running"])
	assert.True(t, sawSuccess, "must emit a final evaluation_state_change with status=success")

	// The load-bearing assertion: a final batch landed on
	// /api/evaluations/batch/log_results carrying the wire shape Studio
	// expects.
	mu.Lock()
	defer mu.Unlock()
	var finalBatch *recordedRequest
	for i := range *captured {
		req := (*captured)[i]
		if req.path == "/api/evaluations/batch/log_results" && req.body["timestamps"] != nil {
			ts, _ := req.body["timestamps"].(map[string]any)
			if _, ok := ts["finished_at"]; ok {
				final := req
				finalBatch = &final
			}
		}
	}
	require.NotNil(t, finalBatch, "expected a final batch POST with finished_at to /api/evaluations/batch/log_results — without this, the UI's experiment-runs page never populates")
	assert.Equal(t, "sk-token", finalBatch.headers.Get("X-Auth-Token"),
		"workflow.api_key must travel as X-Auth-Token (matches the legacy Python posting style)")
	assert.Equal(t, "run_eval_1", finalBatch.body["run_id"])
	assert.Equal(t, "wfv_1", finalBatch.body["workflow_version_id"])
	assert.Equal(t, "wf_eval", finalBatch.body["experiment_slug"], "no experiment_id → fall back to workflow_id slug (Python parity)")
	dataset := finalBatch.body["dataset"].([]any)
	assert.Len(t, dataset, 2, "both dataset rows must be in the final batch")
	evals := finalBatch.body["evaluations"].([]any)
	assert.Len(t, evals, 2, "one evaluator result per dataset row must be in the final batch")
	for _, raw := range evals {
		ev := raw.(map[string]any)
		assert.Equal(t, "eval", ev["evaluator"], "evaluator field must be the node id")
		assert.Equal(t, "processed", ev["status"])
	}
}

// TestEvaluationWorkflow_NonInlineDatasetReturnsActionableError —
// defensive guard for when Studio's loadDatasets() somehow fails to
// inline a saved dataset before forwarding to nlpgo. Originally the
// engine surfaced 'remote datasets not yet supported on Go path'; that
// message broke 3.2.0 prod for a customer because it was confusing
// (the user saw it on what they thought was a fully-supported feature).
// Now the error points operators at the TS-side helper that owns the
// inlining so the right code gets fixed instead of users blaming the
// engine.
func TestEvaluationWorkflow_NonInlineDatasetReturnsActionableError(t *testing.T) {
	url, _, _ := setupEvaluationStack(t)

	envelope := `{
	  "type": "execute_evaluation",
	  "payload": {
	    "trace_id": "trace_remote",
	    "run_id": "run_remote",
	    "workflow_version_id": "v1",
	    "evaluate_on": "full",
	    "workflow": {
	      "workflow_id": "wf_r","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x","template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{"dataset":{"id":"ds_remote"}}},
	        {"id":"end","type":"end","data":{}}
	      ],
	      "edges":[{"id":"e1","source":"entry","sourceHandle":"x","target":"end","targetHandle":"x","type":"default"}],
	      "state":{}
	    }
	  }
	}`

	req, err := http.NewRequest("POST", url+"/go/studio/execute", bytes.NewBufferString(envelope))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)
	frames := readSSE(t, resp.Body, func(f streamFrame) bool { return f.Event == "done" })

	var sawError bool
	for _, f := range frames {
		if f.Event != "evaluation_state_change" {
			continue
		}
		es, _ := f.Data["evaluation_state"].(map[string]any)
		if es["status"] == "error" {
			sawError = true
			msg, _ := es["error"].(string)
			assert.Contains(t, msg, "loadDatasets",
				"error must point operators at the TS-side helper that owns inlining (loadDatasets.ts) so the right code gets fixed")
			assert.Contains(t, msg, "no inline dataset",
				"error must surface the underlying engine-level state for log search")
			break
		}
	}
	assert.True(t, sawError, "non-inline dataset evaluation must emit a structured evaluation_state_change error event")
}

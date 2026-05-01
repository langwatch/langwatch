// Integration test for the evaluator node kind through the full engine
// dispatch path. Spins up a fake LangWatch evaluator endpoint via
// httptest, wires it as the engine's LangWatchBaseURL, and posts a
// workflow that runs entry → evaluator → end.
//
// Proves end-to-end:
//  - planner accepts ComponentEvaluator
//  - engine.runEvaluator builds the right outbound request
//  - evaluatorblock executor's HTTP call lands at the fake server
//  - response (status/score/passed/details/cost) is mapped into the
//    workflow result the way Python's EvaluationResultWithMetadata does.

package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/agentblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/evaluatorblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
	"github.com/langwatch/langwatch/pkg/health"
)

// setupEvaluatorStack mirrors setupStack but wires the evaluator + agent
// executors and points them at a fake LangWatch app httptest server. The
// fake server's behavior is supplied per-test via the handler argument.
func setupEvaluatorStack(t *testing.T, langwatch http.HandlerFunc) (url string, langwatchURL string, requests *[]map[string]any) {
	t.Helper()
	captured := []map[string]any{}
	requestsOut := &captured

	lwSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var parsed map[string]any
		_ = json.Unmarshal(body, &parsed)
		captured = append(captured, map[string]any{
			"path":         r.URL.Path,
			"method":       r.Method,
			"x_auth_token": r.Header.Get("X-Auth-Token"),
			"trace_id":     r.Header.Get("X-LangWatch-Trace-Id"),
			"origin":       r.Header.Get("X-LangWatch-Origin"),
			"body":         parsed,
		})
		langwatch(w, r)
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

	return srv.URL, lwSrv.URL, requestsOut
}

func TestEvaluatorWorkflow_ProcessedResultPropagates(t *testing.T) {
	url, _, requests := setupEvaluatorStack(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":  "processed",
			"score":   0.9,
			"passed":  true,
			"details": "looks good",
			"cost":    map[string]any{"currency": "USD", "amount": 0.001},
		})
	})

	body := `{
	  "workflow": {
	    "workflow_id":"wf","api_key":"sk-project-token","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{"train_size":1.0,"test_size":0.0,"seed":1,
	        "outputs":[{"identifier":"input","type":"str"},{"identifier":"output","type":"str"}],
	        "dataset":{"inline":{"records":{"input":["hello"],"output":["hello"]},"count":1}}}},
	      {"id":"eval","type":"evaluator","data":{
	        "parameters":[
	          {"identifier":"evaluator","type":"str","value":"langevals/exact_match"},
	          {"identifier":"name","type":"str","value":"strict-match"},
	          {"identifier":"settings","type":"dict","value":{"mode":"exact"}}
	        ],
	        "outputs":[
	          {"identifier":"score","type":"float"},
	          {"identifier":"passed","type":"bool"},
	          {"identifier":"details","type":"str"}
	        ]}},
	      {"id":"end","type":"end","data":{"inputs":[
	        {"identifier":"score","type":"float"},
	        {"identifier":"passed","type":"bool"},
	        {"identifier":"details","type":"str"}
	      ]}}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"input","target":"eval","targetHandle":"input","type":"default"},
	      {"id":"e2","source":"entry","sourceHandle":"output","target":"eval","targetHandle":"output","type":"default"},
	      {"id":"e3","source":"eval","sourceHandle":"score","target":"end","targetHandle":"score","type":"default"},
	      {"id":"e4","source":"eval","sourceHandle":"passed","target":"end","targetHandle":"passed","type":"default"},
	      {"id":"e5","source":"eval","sourceHandle":"details","target":"end","targetHandle":"details","type":"default"}
	    ],
	    "state":{}
	  }
	}`

	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	require.NotNil(t, res.Result)
	assert.InDelta(t, 0.9, res.Result["score"], 1e-9)
	assert.Equal(t, true, res.Result["passed"])
	assert.Equal(t, "looks good", res.Result["details"])

	// Validate the upstream wire: exactly one POST to
	// /api/evaluations/langevals/exact_match/evaluate carrying
	// { data, name, settings } and the project apiKey on the
	// X-Auth-Token header.
	require.Len(t, *requests, 1, "expected exactly one evaluator HTTP call, got %d", len(*requests))
	rec := (*requests)[0]
	assert.Equal(t, http.MethodPost, rec["method"])
	assert.Equal(t, "/api/evaluations/langevals/exact_match/evaluate", rec["path"])
	assert.Equal(t, "sk-project-token", rec["x_auth_token"])
	body0 := rec["body"].(map[string]any)
	assert.Equal(t, "strict-match", body0["name"])
	settings := body0["settings"].(map[string]any)
	assert.Equal(t, "exact", settings["mode"])
	data := body0["data"].(map[string]any)
	assert.Equal(t, "hello", data["input"])
	assert.Equal(t, "hello", data["output"])
}

// TestEvaluatorWorkflow_TraceIDPropagatesWhenAutoGenerated pins the
// CR major: when the caller doesn't supply a trace_id, the engine
// generates one and must write it back into the request so downstream
// dispatch (runEvaluator) sees it. Before the fix, runEvaluator read
// req.TraceID (still "") and the X-LangWatch-Trace-Id header was
// absent, so server-side evaluator spans had no correlation back to
// the workflow execution.
func TestEvaluatorWorkflow_TraceIDPropagatesWhenAutoGenerated(t *testing.T) {
	url, _, requests := setupEvaluatorStack(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "processed", "score": 1.0, "passed": true,
		})
	})

	// No trace_id in the envelope — engine must mint one and surface it.
	body := `{
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{"train_size":1.0,"test_size":0.0,"seed":1,
	        "outputs":[{"identifier":"input","type":"str"},{"identifier":"output","type":"str"}],
	        "dataset":{"inline":{"records":{"input":["x"],"output":["x"]},"count":1}}}},
	      {"id":"eval","type":"evaluator","data":{
	        "parameters":[{"identifier":"evaluator","type":"str","value":"langevals/exact_match"}]
	      }},
	      {"id":"end","type":"end","data":{}}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"input","target":"eval","targetHandle":"input","type":"default"},
	      {"id":"e2","source":"entry","sourceHandle":"output","target":"eval","targetHandle":"output","type":"default"},
	      {"id":"e3","source":"eval","sourceHandle":"any","target":"end","targetHandle":"any","type":"default"}
	    ],
	    "state":{}
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	// Engine generated a trace id…
	assert.NotEmpty(t, res.TraceID, "engine should auto-generate a trace id when none is supplied")
	// …AND propagated it to the evaluator request header (the load-bearing claim).
	require.Len(t, *requests, 1)
	rec := (*requests)[0]
	assert.Equal(t, res.TraceID, rec["trace_id"],
		"X-LangWatch-Trace-Id on the evaluator request must match the engine-generated trace id")
	assert.NotEmpty(t, rec["trace_id"], "trace_id header must be present on the evaluator request")
}

func TestEvaluatorWorkflow_UpstreamErrorSurfacesAsNodeError(t *testing.T) {
	url, _, _ := setupEvaluatorStack(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("evaluator pool exhausted"))
	})

	body := `{
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{"train_size":1.0,"test_size":0.0,"seed":1,
	        "outputs":[{"identifier":"input","type":"str"}],
	        "dataset":{"inline":{"records":{"input":["x"]},"count":1}}}},
	      {"id":"eval","type":"evaluator","data":{
	        "parameters":[{"identifier":"evaluator","type":"str","value":"langevals/exact_match"}]
	      }},
	      {"id":"end","type":"end","data":{}}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"input","target":"eval","targetHandle":"input","type":"default"},
	      {"id":"e2","source":"eval","sourceHandle":"any","target":"end","targetHandle":"any","type":"default"}
	    ],
	    "state":{}
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Equal(t, "evaluator_error", res.Error.Type)
	assert.True(t, strings.Contains(res.Error.Message, "500") || strings.Contains(res.Error.Message, "evaluator pool exhausted"),
		"error message should reference the upstream 500 or its body, got %q", res.Error.Message)
}

// TestEvaluatorWorkflow_TypedEvaluatorFieldShape pins the canonical
// Studio shape: the evaluator slug lives on `data.evaluator` (typed
// field), NOT inside `data.parameters[]`. langwatch/src/optimization_
// studio/types/dsl.ts:243 defines `evaluator?: EvaluatorTypes |
// "custom/<id>" | "evaluators/<id>"`. Before the fix, runEvaluator
// only read paramString(parameters, "evaluator") so any node persisted
// in the canonical shape failed with `evaluator parameter is required`
// even though the slug was present (rchaves dogfood 2026-04-29 on
// workflow_qtBZcCf4ch5xfxBm-NIZL with ExactMatch evaluator).
func TestEvaluatorWorkflow_TypedEvaluatorFieldShape(t *testing.T) {
	url, _, requests := setupEvaluatorStack(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "processed", "score": 1.0, "passed": true,
		})
	})

	body := `{
	  "workflow": {
	    "workflow_id":"wf","api_key":"sk-project-token","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{"train_size":1.0,"test_size":0.0,"seed":1,
	        "outputs":[{"identifier":"input","type":"str"},{"identifier":"output","type":"str"}],
	        "dataset":{"inline":{"records":{"input":["hello"],"output":["hello"]},"count":1}}}},
	      {"id":"eval","type":"evaluator","data":{
	        "evaluator":"langevals/exact_match"
	      }},
	      {"id":"end","type":"end","data":{}}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"input","target":"eval","targetHandle":"input","type":"default"},
	      {"id":"e2","source":"entry","sourceHandle":"output","target":"eval","targetHandle":"output","type":"default"},
	      {"id":"e3","source":"eval","sourceHandle":"any","target":"end","targetHandle":"any","type":"default"}
	    ],
	    "state":{}
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	require.Len(t, *requests, 1, "exactly one upstream evaluator call expected")
	rec := (*requests)[0]
	assert.Equal(t, "/api/evaluations/langevals/exact_match/evaluate", rec["path"],
		"slug from data.evaluator must drive the upstream URL path")
}

func TestEvaluatorWorkflow_MissingSlugReturnsTypedError(t *testing.T) {
	url, _, requests := setupEvaluatorStack(t, func(w http.ResponseWriter, _ *http.Request) {
		// upstream should never be hit when the slug is missing
		t.Fatal("upstream evaluator endpoint must not be hit when slug is missing")
		_ = w
	})

	body := `{
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{"train_size":1.0,"test_size":0.0,"seed":1}},
	      {"id":"eval","type":"evaluator","data":{}},
	      {"id":"end","type":"end","data":{}}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"x","target":"eval","targetHandle":"x","type":"default"},
	      {"id":"e2","source":"eval","sourceHandle":"x","target":"end","targetHandle":"x","type":"default"}
	    ],
	    "state":{}
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "error", res.Status)
	assert.Equal(t, "evaluator_missing_slug", res.Error.Type)
	assert.Empty(t, *requests, "no upstream calls expected")
}

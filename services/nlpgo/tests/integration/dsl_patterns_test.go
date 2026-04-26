// Package integration_test — dsl_patterns_test.go is the home for
// regression tests derived from real-world Studio workflow shapes.
//
// Why this file exists:
//
//   The /go/* engine has unit-level coverage on every block executor and
//   provider-level coverage in the live e2es. What's NOT covered today is
//   structurally-realistic *combinations*: a 3-node linear chain with an
//   evaluator at the tail; a branching workflow with two signature
//   siblings that converge at an end node; a workflow that uses the
//   liquid-templated http block to fan out and a code block to reduce.
//
//   Customers in the wild have these shapes today and they need to keep
//   working bit-identical when their project flips to the Go path. This
//   file is where we mirror those shapes — with the explicit rule that
//   ZERO of the customer's actual content lands here.
//
// Anonymisation rules (load-bearing, do not relax):
//
//   - No customer name, no project name, no project id — anywhere.
//     Not in code. Not in comments. Not in fixture filenames. Not in
//     test names. Not in commit messages or PR descriptions referencing
//     this file.
//   - No copy of customer prompt text. We replicate the *shape* of the
//     prompt (system + user + variables, liquid usage, JSON-schema
//     output, etc.) but the actual words are ours.
//   - No replication of customer domain concepts. If the customer's
//     workflow is a "loan-application classifier", our equivalent
//     fixture is a "weather classifier" or "fictional Q&A". The
//     structural pattern is what matters; the surface should be
//     unambiguously generic.
//   - No second-order leaks. If a customer's evaluator slug encodes a
//     domain hint (e.g. "team-name/loan-grading-judge"), our analog
//     uses "team-x/topic-judge" or similar.
//
// How to add a new pattern:
//
//   1. From the redacted /tmp/nlpgo-prod-summary.md (NOT committed),
//      pick a structural pattern that isn't covered yet — e.g.
//      "evaluator with langevals/llm_judge slug + structured-output
//      signature upstream + liquid-templated system prompt".
//   2. Build the smallest fixture that exercises that exact shape. Use
//      generic concept names (math, weather, dialogue, fiction).
//   3. Run it through the existing setupEvaluatorStack harness so the
//      LangWatch endpoint is faked end-to-end, no real network calls.
//   4. Assert on the *engine outputs* (workflow result, node states,
//      cost propagation) — not on the prompt body. The prompt is ours
//      and shouldn't be load-bearing.
//
// Coverage map (filled in as patterns land):
//
//   pattern_001_linear_chain   — entry → signature(template) → evaluator → end ✅
//   pattern_002_branching      — TBD once data lands
//   pattern_003_liquid_in_sig  — TBD once data lands
//   pattern_004_chain_eval     — TBD once data lands
//
// See feedback memory entry "No customer names in public repo".

package integration_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

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

// fakeLLMClient is the in-process LLMClient used by pattern tests. It
// captures every Execute call so a test can assert the messages that
// reached the gateway boundary — important for proving template
// rendering happened upstream of the call rather than just being a
// buildMessages unit-test artifact.
type fakeLLMClient struct {
	mu       sync.Mutex
	requests []app.LLMRequest
	respond  func(req app.LLMRequest) (*app.LLMResponse, error)
}

func (f *fakeLLMClient) Execute(_ context.Context, req app.LLMRequest) (*app.LLMResponse, error) {
	f.mu.Lock()
	f.requests = append(f.requests, req)
	f.mu.Unlock()
	if f.respond != nil {
		return f.respond(req)
	}
	return &app.LLMResponse{Content: ""}, nil
}

func (f *fakeLLMClient) ExecuteStream(_ context.Context, _ app.LLMRequest) (app.StreamIterator, error) {
	return nil, errors.New("fake llm: streaming not used in pattern tests")
}

func (f *fakeLLMClient) lastRequest(t *testing.T) app.LLMRequest {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	require.NotEmpty(t, f.requests, "expected at least one LLM Execute call")
	return f.requests[len(f.requests)-1]
}

// setupPatternStack is the harness for dsl_patterns tests. It combines
// what setupEvaluatorStack provides (HTTP/code/evaluator/agent + fake
// LangWatch endpoint) with an injected fake LLM, so a workflow that
// chains signature → evaluator runs entirely in-process with both
// boundaries observable.
func setupPatternStack(t *testing.T, llm *fakeLLMClient, langwatch http.HandlerFunc) (url string, requests *[]map[string]any) {
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
		LLM:              llm,
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

	return srv.URL, requestsOut
}

// TestPattern001_LinearChain — entry → signature(with liquid system prompt)
// → evaluator → end. Smallest realistic shape: a customer-style scoring
// pipeline where the model answers a templated question and a downstream
// evaluator grades the answer.
//
// What this proves end-to-end through the engine (not through unit
// tests of any single component):
//
//   1. The signature node's `instructions` parameter is liquid-rendered
//      against upstream inputs before reaching the LLM (verified by
//      inspecting what the fake LLM was actually called with — not just
//      what buildMessages produced in isolation).
//   2. The signature node's output flows down the edge into the
//      evaluator node's `data` payload to the LangWatch evaluator API.
//   3. The evaluator's score/passed/details propagate to the end node
//      and surface in the workflow result.
//   4. Per-node state for all four nodes is "success" and present in
//      result.nodes.
//
// Concept is intentionally generic (math Q&A judge); zero customer
// domain or copy.
func TestPattern001_LinearChain_SignatureWithTemplateThenEvaluator(t *testing.T) {
	llm := &fakeLLMClient{
		respond: func(_ app.LLMRequest) (*app.LLMResponse, error) {
			return &app.LLMResponse{Content: "8", Cost: 0.0001}, nil
		},
	}
	url, lwRequests := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":  "processed",
			"score":   1.0,
			"passed":  true,
			"details": "answer matches expected",
			"cost":    map[string]any{"currency": "USD", "amount": 0.00005},
		})
	})

	body := `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-001",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"sk-pattern-001","spec_version":"1.3",
	      "name":"Pattern001","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[
	            {"identifier":"question","type":"str"},
	            {"identifier":"expected","type":"str"}
	          ],
	          "dataset":{"inline":{"records":{
	            "question":["What is 4+4?"],
	            "expected":["8"]
	          },"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"answer","type":"signature","data":{
	          "name":"Answer",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"You are a math tutor. Reply with only the digit answer to: {{ question }}"}
	          ],
	          "inputs":[{"identifier":"question","type":"str"}],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"grade","type":"evaluator","data":{
	          "parameters":[
	            {"identifier":"evaluator","type":"str","value":"langevals/exact_match"},
	            {"identifier":"name","type":"str","value":"answer-matches-expected"},
	            {"identifier":"settings","type":"dict","value":{"mode":"exact"}}
	          ],
	          "outputs":[
	            {"identifier":"score","type":"float"},
	            {"identifier":"passed","type":"bool"},
	            {"identifier":"details","type":"str"}
	          ]
	        }},
	        {"id":"end","type":"end","data":{"inputs":[
	          {"identifier":"score","type":"float"},
	          {"identifier":"passed","type":"bool"},
	          {"identifier":"details","type":"str"}
	        ]}}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.question","target":"answer","targetHandle":"inputs.question","type":"default"},
	        {"id":"e2","source":"answer","sourceHandle":"outputs.answer","target":"grade","targetHandle":"inputs.output","type":"default"},
	        {"id":"e3","source":"entry","sourceHandle":"outputs.expected","target":"grade","targetHandle":"inputs.expected_output","type":"default"},
	        {"id":"e4","source":"grade","sourceHandle":"outputs.score","target":"end","targetHandle":"inputs.score","type":"default"},
	        {"id":"e5","source":"grade","sourceHandle":"outputs.passed","target":"end","targetHandle":"inputs.passed","type":"default"},
	        {"id":"e6","source":"grade","sourceHandle":"outputs.details","target":"end","targetHandle":"inputs.details","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.Equal(t, "pattern-001", res.TraceID)

	// (1) The fake LLM saw the rendered system prompt — proves the
	// template render happened in-engine, not just in a unit test.
	llmReq := llm.lastRequest(t)
	require.NotEmpty(t, llmReq.Messages, "expected at least one chat message")
	var sysContent string
	for _, m := range llmReq.Messages {
		if m.Role == "system" {
			sysContent, _ = m.Content.(string)
			break
		}
	}
	assert.Contains(t, sysContent, "What is 4+4?",
		"system prompt should have {{ question }} liquid-rendered, got %q", sysContent)
	assert.NotContains(t, sysContent, "{{ question }}",
		"raw {{ }} markers must not survive in the system prompt")

	// (2) Evaluator received the signature's answer — assert by
	// inspecting the captured LangWatch request.
	require.Len(t, *lwRequests, 1, "expected exactly one evaluator HTTP call")
	rec := (*lwRequests)[0]
	assert.Equal(t, "/api/evaluations/langevals/exact_match/evaluate", rec["path"])
	assert.Equal(t, "sk-pattern-001", rec["x_auth_token"])
	data := rec["body"].(map[string]any)["data"].(map[string]any)
	assert.Equal(t, "8", data["output"], "signature output must reach evaluator data.output")
	assert.Equal(t, "8", data["expected_output"], "entry.expected must reach evaluator data.expected_output")

	// (3) Workflow result carries score/passed/details.
	require.NotNil(t, res.Result)
	assert.InDelta(t, 1.0, res.Result["score"], 1e-9)
	assert.Equal(t, true, res.Result["passed"])
	assert.Equal(t, "answer matches expected", res.Result["details"])

	// (4) All four nodes in success state.
	require.NotNil(t, res.Nodes)
	for _, id := range []string{"entry", "answer", "grade", "end"} {
		node, ok := res.Nodes[id].(map[string]any)
		require.True(t, ok, "missing node %q in result.nodes", id)
		assert.Equal(t, "success", node["status"], "node %q expected success", id)
	}
}

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
//   pattern_002_branching      — entry → 2× parallel signature → end           ✅
//   pattern_003_liquid_in_sig  — multi-var, dot-path, array-index in one prompt ✅
//   pattern_004_chain_eval     — signature → signature → evaluator chain        ✅
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

// TestPattern002_BranchingParallelSignatures — entry → 2 parallel
// signature siblings → end with both outputs. Customer-style fan-out
// where one input is processed by two independent LLM calls (e.g. a
// "summary" and a "sentiment" computed from the same source text)
// and both results are returned.
//
// What this proves:
//
//   1. The planner places the two signatures in the SAME layer (they
//      share inputs, no dependency on each other) — verified by the
//      fact that both LLM calls are observed and both end-node fields
//      populate.
//   2. The engine's per-layer concurrency (one goroutine per node)
//      does not corrupt the per-node Inputs/Outputs maps when two
//      signature nodes run side-by-side. Each fake LLM call sees the
//      shared input and produces an independent output.
//   3. End node merges both signature outputs into result.
func TestPattern002_BranchingParallelSignatures(t *testing.T) {
	llm := &fakeLLMClient{
		respond: func(req app.LLMRequest) (*app.LLMResponse, error) {
			// Distinguish which sibling is calling by inspecting the
			// system prompt — pattern_001 already proved templating
			// reaches here, so it's the cleanest discriminator.
			var sys string
			for _, m := range req.Messages {
				if m.Role == "system" {
					sys, _ = m.Content.(string)
					break
				}
			}
			content := "default"
			switch {
			case stringContains(sys, "sentiment"):
				content = "positive"
			case stringContains(sys, "summary"):
				content = "two-line summary of the input"
			}
			return &app.LLMResponse{Content: content}, nil
		},
	}
	url, _ := setupPatternStack(t, llm, func(http.ResponseWriter, *http.Request) {})

	body := `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-002",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3",
	      "name":"Pattern002","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"text","type":"str"}],
	          "dataset":{"inline":{"records":{"text":["A pleasant afternoon by the river."]},"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"sentiment","type":"signature","data":{
	          "name":"Sentiment",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"Classify the sentiment of: {{ text }}"}
	          ],
	          "inputs":[{"identifier":"text","type":"str"}],
	          "outputs":[{"identifier":"sentiment","type":"str"}]
	        }},
	        {"id":"summary","type":"signature","data":{
	          "name":"Summary",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"Write a one-sentence summary of: {{ text }}"}
	          ],
	          "inputs":[{"identifier":"text","type":"str"}],
	          "outputs":[{"identifier":"summary","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{"inputs":[
	          {"identifier":"sentiment","type":"str"},
	          {"identifier":"summary","type":"str"}
	        ]}}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.text","target":"sentiment","targetHandle":"inputs.text","type":"default"},
	        {"id":"e2","source":"entry","sourceHandle":"outputs.text","target":"summary","targetHandle":"inputs.text","type":"default"},
	        {"id":"e3","source":"sentiment","sourceHandle":"outputs.sentiment","target":"end","targetHandle":"inputs.sentiment","type":"default"},
	        {"id":"e4","source":"summary","sourceHandle":"outputs.summary","target":"end","targetHandle":"inputs.summary","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	// Both LLM calls happened (one per sibling), and the engine merged
	// both outputs into the workflow result.
	llm.mu.Lock()
	got := len(llm.requests)
	llm.mu.Unlock()
	assert.Equal(t, 2, got, "expected exactly two LLM Execute calls (one per parallel signature)")

	require.NotNil(t, res.Result)
	assert.Equal(t, "positive", res.Result["sentiment"])
	assert.Equal(t, "two-line summary of the input", res.Result["summary"])

	require.NotNil(t, res.Nodes)
	for _, id := range []string{"entry", "sentiment", "summary", "end"} {
		node, ok := res.Nodes[id].(map[string]any)
		require.True(t, ok, "missing node %q", id)
		assert.Equal(t, "success", node["status"], "node %q expected success", id)
	}
}

// TestPattern003_HeavyLiquidTemplating — single signature whose
// instructions exercise multiple liquid forms in one render: simple
// {{ var }}, dot-path {{ x.y }}, array-index {{ arr[0] }}. Customers
// stack these freely; this fixture catches partial-render regressions
// where one form works but another silently doesn't.
func TestPattern003_HeavyLiquidTemplating(t *testing.T) {
	llm := &fakeLLMClient{
		respond: func(_ app.LLMRequest) (*app.LLMResponse, error) {
			return &app.LLMResponse{Content: "ok"}, nil
		},
	}
	url, _ := setupPatternStack(t, llm, func(http.ResponseWriter, *http.Request) {})

	body := `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-003",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3",
	      "name":"Pattern003","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[
	            {"identifier":"task","type":"str"},
	            {"identifier":"profile","type":"dict"},
	            {"identifier":"tags","type":"list"}
	          ],
	          "dataset":{"inline":{"records":{
	            "task":["Translate to French"],
	            "profile":[{"name":"Ada","tier":"pro"}],
	            "tags":[["urgent","french","short"]]
	          },"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"answer","type":"signature","data":{
	          "name":"Answer",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"Hello {{ profile.name }} (tier: {{ profile.tier }}). Your task: {{ task }}. Top tag: {{ tags[0] }}."}
	          ],
	          "inputs":[
	            {"identifier":"task","type":"str"},
	            {"identifier":"profile","type":"dict"},
	            {"identifier":"tags","type":"list"}
	          ],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{"inputs":[{"identifier":"answer","type":"str"}]}}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.task","target":"answer","targetHandle":"inputs.task","type":"default"},
	        {"id":"e2","source":"entry","sourceHandle":"outputs.profile","target":"answer","targetHandle":"inputs.profile","type":"default"},
	        {"id":"e3","source":"entry","sourceHandle":"outputs.tags","target":"answer","targetHandle":"inputs.tags","type":"default"},
	        {"id":"e4","source":"answer","sourceHandle":"outputs.answer","target":"end","targetHandle":"inputs.answer","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	llmReq := llm.lastRequest(t)
	var sys string
	for _, m := range llmReq.Messages {
		if m.Role == "system" {
			sys, _ = m.Content.(string)
			break
		}
	}
	// Every liquid form must have rendered.
	assert.Contains(t, sys, "Hello Ada", "{{ profile.name }} should render")
	assert.Contains(t, sys, "tier: pro", "{{ profile.tier }} should render")
	assert.Contains(t, sys, "Translate to French", "{{ task }} should render")
	assert.Contains(t, sys, "Top tag: urgent", "{{ tags[0] }} should render")
	assert.NotContains(t, sys, "{{", "no raw {{ }} markers should remain")
	assert.NotContains(t, sys, "}}", "no raw {{ }} markers should remain")
}

// TestPattern004_SignatureChainThenEvaluator — two signatures wired
// in series, feeding an evaluator. Customer-style refinement shape:
// a draft step then a polish step before grading.
//
// What this proves:
//
//   1. The planner orders the two signatures in distinct layers
//      (refine depends on draft); both LLM calls happen and the second
//      sees the first's output as input.
//   2. The signature output → next signature input edge resolves
//      correctly (no DSL parser regression on chained signature-only
//      paths).
//   3. The evaluator at the tail reads the final refined answer and
//      grades it.
func TestPattern004_SignatureChainThenEvaluator(t *testing.T) {
	llm := &fakeLLMClient{
		respond: func(req app.LLMRequest) (*app.LLMResponse, error) {
			var sys string
			for _, m := range req.Messages {
				if m.Role == "system" {
					sys, _ = m.Content.(string)
					break
				}
			}
			switch {
			case stringContains(sys, "Draft"):
				return &app.LLMResponse{Content: "rough draft about apples"}, nil
			case stringContains(sys, "Refine"):
				// Refiner sees the draft as its input — verifies the
				// signature→signature edge round-tripped via {{ draft }}.
				assert.Contains(t, sys, "rough draft about apples",
					"refine prompt should contain the draft via {{ draft }}, got %q", sys)
				return &app.LLMResponse{Content: "polished answer about apples"}, nil
			}
			return &app.LLMResponse{Content: "fallback"}, nil
		},
	}
	url, lwRequests := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":  "processed",
			"score":   0.8,
			"passed":  true,
			"details": "polished",
			"cost":    map[string]any{"currency": "USD", "amount": 0.0001},
		})
	})

	body := `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-004",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3",
	      "name":"Pattern004","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"topic","type":"str"}],
	          "dataset":{"inline":{"records":{"topic":["apples"]},"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"draft","type":"signature","data":{
	          "name":"Draft",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"Draft a short paragraph about: {{ topic }}"}
	          ],
	          "inputs":[{"identifier":"topic","type":"str"}],
	          "outputs":[{"identifier":"draft","type":"str"}]
	        }},
	        {"id":"refine","type":"signature","data":{
	          "name":"Refine",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"Refine this draft: {{ draft }}"}
	          ],
	          "inputs":[{"identifier":"draft","type":"str"}],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"grade","type":"evaluator","data":{
	          "parameters":[
	            {"identifier":"evaluator","type":"str","value":"langevals/llm_judge"},
	            {"identifier":"name","type":"str","value":"polish-judge"},
	            {"identifier":"settings","type":"dict","value":{"criteria":"clarity"}}
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
	        {"id":"e1","source":"entry","sourceHandle":"outputs.topic","target":"draft","targetHandle":"inputs.topic","type":"default"},
	        {"id":"e2","source":"draft","sourceHandle":"outputs.draft","target":"refine","targetHandle":"inputs.draft","type":"default"},
	        {"id":"e3","source":"refine","sourceHandle":"outputs.answer","target":"grade","targetHandle":"inputs.output","type":"default"},
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

	// Two LLM calls (draft + refine), in order. Order is enforced by
	// the dependency edge — the refiner can't run before draft completes.
	llm.mu.Lock()
	got := len(llm.requests)
	llm.mu.Unlock()
	assert.Equal(t, 2, got, "expected two LLM Execute calls (draft + refine)")

	// Evaluator received the refined output.
	require.Len(t, *lwRequests, 1)
	data := (*lwRequests)[0]["body"].(map[string]any)["data"].(map[string]any)
	assert.Equal(t, "polished answer about apples", data["output"])

	// Workflow result + node states.
	require.NotNil(t, res.Result)
	assert.InDelta(t, 0.8, res.Result["score"], 1e-9)
	assert.Equal(t, true, res.Result["passed"])
	for _, id := range []string{"entry", "draft", "refine", "grade", "end"} {
		node, ok := res.Nodes[id].(map[string]any)
		require.True(t, ok, "missing node %q", id)
		assert.Equal(t, "success", node["status"], "node %q expected success", id)
	}
}

// stringContains is a tiny case-sensitive substring helper to avoid
// pulling strings just for these branch discriminators.
func stringContains(s, sub string) bool {
	if len(sub) == 0 {
		return true
	}
	if len(s) < len(sub) {
		return false
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

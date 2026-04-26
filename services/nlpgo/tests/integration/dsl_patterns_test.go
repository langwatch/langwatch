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
//   pattern_005_http_to_sig    — http block fetches data, signature uses it    ✅
//   pattern_006_sigs_to_code   — 2× parallel signature → code aggregator       ✅
//   pattern_007_multi_output   — signature with 2+ outputs → JSON parse+split  ✅
//   pattern_008_llm_boolean    — sig → evaluator(langevals/llm_boolean)        ✅
//   pattern_009_llm_category   — sig → evaluator(langevals/llm_category)       ✅
//   pattern_010_custom_safety  — custom node kind → typed unsupported error    ✅
//
// See feedback memory entry "No customer names in public repo".

package integration_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
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

// TestPattern007_MultiOutputSignatureParseAndSplit — single signature
// with two declared outputs. Customer-style structured shape:
// classifier emits {label, confidence} as one JSON object; the engine
// must wire response_format json_schema upstream AND parse the JSON
// reply back into separate outputs at the gateway boundary.
//
// What this proves:
//
//   1. The signature node detects 2+ outputs and wires
//      response_format = json_schema in the LLMRequest. Verified by
//      inspecting the captured request at the LLM boundary.
//   2. The composed JSON Schema lists both outputs as required and
//      maps each to its appropriate JSON Schema type.
//   3. The engine parses the LLM's JSON response and splits the
//      properties into the corresponding outputs (label → str,
//      confidence → number) — no longer assigning the same Content
//      to every declared output.
func TestPattern007_MultiOutputSignatureParseAndSplit(t *testing.T) {
	llm := &fakeLLMClient{
		respond: func(req app.LLMRequest) (*app.LLMResponse, error) {
			// Provider would normally enforce the schema; we just need
			// a JSON-parseable payload that matches the declared shape.
			return &app.LLMResponse{Content: `{"label":"weather","confidence":0.93}`}, nil
		},
	}
	url, _ := setupPatternStack(t, llm, func(http.ResponseWriter, *http.Request) {})

	body := `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-007",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3",
	      "name":"Pattern007","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"text","type":"str"}],
	          "dataset":{"inline":{"records":{"text":["A pleasant afternoon."]},"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"classify","type":"signature","data":{
	          "name":"Classify",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"Classify the sentiment of: {{ text }}. Reply with label + confidence."}
	          ],
	          "inputs":[{"identifier":"text","type":"str"}],
	          "outputs":[
	            {"identifier":"label","type":"str"},
	            {"identifier":"confidence","type":"float"}
	          ]
	        }},
	        {"id":"end","type":"end","data":{"inputs":[
	          {"identifier":"label","type":"str"},
	          {"identifier":"confidence","type":"float"}
	        ]}}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.text","target":"classify","targetHandle":"inputs.text","type":"default"},
	        {"id":"e2","source":"classify","sourceHandle":"outputs.label","target":"end","targetHandle":"inputs.label","type":"default"},
	        {"id":"e3","source":"classify","sourceHandle":"outputs.confidence","target":"end","targetHandle":"inputs.confidence","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	// (1) ResponseFormat was wired and reached the LLM boundary as
	// type=json_schema with both outputs as required properties.
	llmReq := llm.lastRequest(t)
	require.NotNil(t, llmReq.ResponseFormat,
		"signature with 2 outputs must request structured response_format")
	assert.Equal(t, "json_schema", llmReq.ResponseFormat.Type)
	js := llmReq.ResponseFormat.JSONSchema
	require.NotNil(t, js)
	schema := js["schema"].(map[string]any)
	props := schema["properties"].(map[string]any)
	require.NotNil(t, props["label"])
	require.NotNil(t, props["confidence"])
	required, _ := schema["required"].([]string)
	if required == nil {
		// May be []any after JSON round-trip in some paths
		if alt, ok := schema["required"].([]any); ok {
			for _, v := range alt {
				required = append(required, v.(string))
			}
		}
	}
	assert.ElementsMatch(t, []string{"label", "confidence"}, required)

	// (2) Both outputs land in the workflow result with the right
	// values — proves parse-and-split happened, not the old "every
	// output gets the raw content" bug.
	require.NotNil(t, res.Result)
	assert.Equal(t, "weather", res.Result["label"])
	assert.InDelta(t, 0.93, res.Result["confidence"], 1e-9)
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

// setupPatternStackWithUpstream is the pattern_005+ harness: same
// in-process wiring as setupPatternStack, plus an SSRF allow-list that
// permits the supplied upstream host so the http-block can reach a
// test httptest server.
func setupPatternStackWithUpstream(t *testing.T, llm *fakeLLMClient, langwatch http.HandlerFunc, upstreamHost string) (url string, lwRequests *[]map[string]any) {
	t.Helper()
	captured := []map[string]any{}
	requestsOut := &captured

	lwSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var parsed map[string]any
		_ = json.Unmarshal(body, &parsed)
		captured = append(captured, map[string]any{
			"path": r.URL.Path, "body": parsed,
		})
		langwatch(w, r)
	}))
	t.Cleanup(lwSrv.Close)

	httpExec := httpblock.New(httpblock.Options{
		SSRF: httpblock.SSRFOptions{AllowedHosts: []string{upstreamHost}},
	})
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
	router := httpapi.NewRouter(httpapi.RouterDeps{App: application, Health: probes, Version: "test"})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return srv.URL, requestsOut
}

// TestPattern005_HTTPThenSignatureWithLiquidUse — entry → http (fetches
// data) → signature (uses the http output via {{ http_output }} in
// instructions) → end. Customer-style retrieval-augmented shape: pull
// some context over HTTP, fold it into the prompt.
//
// What this proves:
//
//   1. The http block's response body lands in the engine state under
//      the configured output name.
//   2. The signature node receives the http output as an upstream
//      input AND the engine renders {{ <input_name> }} from it inside
//      `instructions`. (Catches both the edge-routing path AND the
//      Liquid render path in one shot.)
//   3. The composed system prompt observed at the LLM boundary
//      contains the http payload — not the raw {{ }} marker.
func TestPattern005_HTTPThenSignatureWithLiquidUse(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"forecast":"sunny with a high of 24C"}`))
	}))
	t.Cleanup(upstream.Close)
	upstreamHost, _, _ := net.SplitHostPort(upstream.Listener.Addr().String())

	llm := &fakeLLMClient{
		respond: func(_ app.LLMRequest) (*app.LLMResponse, error) {
			return &app.LLMResponse{Content: "Looks like a great day."}, nil
		},
	}
	url, _ := setupPatternStackWithUpstream(t, llm, func(http.ResponseWriter, *http.Request) {}, upstreamHost)

	body := `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-005",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3",
	      "name":"Pattern005","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"city","type":"str"}],
	          "dataset":{"inline":{"records":{"city":["Lisbon"]},"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"fetch","type":"http","data":{
	          "parameters":[
	            {"identifier":"url","type":"str","value":"` + upstream.URL + `/forecast"},
	            {"identifier":"method","type":"str","value":"GET"},
	            {"identifier":"output_path","type":"str","value":"$.forecast"}
	          ],
	          "outputs":[{"identifier":"forecast","type":"str"}]
	        }},
	        {"id":"narrate","type":"signature","data":{
	          "name":"Narrate",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"Forecast for the user: {{ forecast }}. Reply in one sentence."}
	          ],
	          "inputs":[{"identifier":"forecast","type":"str"}],
	          "outputs":[{"identifier":"narration","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{"inputs":[{"identifier":"narration","type":"str"}]}}
	      ],
	      "edges":[
	        {"id":"e1","source":"fetch","sourceHandle":"outputs.forecast","target":"narrate","targetHandle":"inputs.forecast","type":"default"},
	        {"id":"e2","source":"narrate","sourceHandle":"outputs.narration","target":"end","targetHandle":"inputs.narration","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	// The LLM saw the upstream's forecast text rendered into the prompt.
	llmReq := llm.lastRequest(t)
	var sys string
	for _, m := range llmReq.Messages {
		if m.Role == "system" {
			sys, _ = m.Content.(string)
			break
		}
	}
	assert.Contains(t, sys, "sunny with a high of 24C",
		"signature instructions should have {{ forecast }} rendered from the http output, got %q", sys)
	assert.NotContains(t, sys, "{{ forecast }}",
		"raw {{ forecast }} marker must not survive in the prompt")

	require.NotNil(t, res.Result)
	assert.Equal(t, "Looks like a great day.", res.Result["narration"])
	for _, id := range []string{"fetch", "narrate", "end"} {
		node, ok := res.Nodes[id].(map[string]any)
		require.True(t, ok, "missing node %q", id)
		assert.Equal(t, "success", node["status"], "node %q expected success", id)
	}
}

// TestPattern006_TwoSignaturesIntoCodeAggregator — entry → 2× parallel
// signature → code (combines both outputs) → end. Customer-style
// reduce step where two LLM-produced fields are merged into a single
// structured payload by deterministic Python code.
//
// What this proves:
//
//   1. The code block accepts both signature outputs as inputs (named
//      kwargs `summary` and `sentiment`) — proves the engine wires
//      multiple upstream signature outputs into one downstream code
//      block correctly.
//   2. The code block's structured return propagates to the end node.
//   3. All five nodes report "success".
func TestPattern006_TwoSignaturesIntoCodeAggregator(t *testing.T) {
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
			case stringContains(sys, "summary"):
				return &app.LLMResponse{Content: "Two clear paragraphs."}, nil
			case stringContains(sys, "sentiment"):
				return &app.LLMResponse{Content: "neutral"}, nil
			}
			return &app.LLMResponse{Content: "fallback"}, nil
		},
	}
	url, _ := setupPatternStack(t, llm, func(http.ResponseWriter, *http.Request) {})

	body := `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-006",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3",
	      "name":"Pattern006","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"text","type":"str"}],
	          "dataset":{"inline":{"records":{"text":["A short article about clouds."]},"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"summarize","type":"signature","data":{
	          "name":"Summarize",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"Write a one-line summary of: {{ text }}"}
	          ],
	          "inputs":[{"identifier":"text","type":"str"}],
	          "outputs":[{"identifier":"summary","type":"str"}]
	        }},
	        {"id":"classify","type":"signature","data":{
	          "name":"Classify",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"Classify the sentiment of: {{ text }}"}
	          ],
	          "inputs":[{"identifier":"text","type":"str"}],
	          "outputs":[{"identifier":"sentiment","type":"str"}]
	        }},
	        {"id":"merge","type":"code","data":{
	          "parameters":[
	            {"identifier":"code","type":"code","value":"def execute(summary, sentiment):\n    return {'report': sentiment + ': ' + summary}\n"}
	          ],
	          "inputs":[
	            {"identifier":"summary","type":"str"},
	            {"identifier":"sentiment","type":"str"}
	          ],
	          "outputs":[{"identifier":"report","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{"inputs":[{"identifier":"report","type":"str"}]}}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.text","target":"summarize","targetHandle":"inputs.text","type":"default"},
	        {"id":"e2","source":"entry","sourceHandle":"outputs.text","target":"classify","targetHandle":"inputs.text","type":"default"},
	        {"id":"e3","source":"summarize","sourceHandle":"outputs.summary","target":"merge","targetHandle":"inputs.summary","type":"default"},
	        {"id":"e4","source":"classify","sourceHandle":"outputs.sentiment","target":"merge","targetHandle":"inputs.sentiment","type":"default"},
	        {"id":"e5","source":"merge","sourceHandle":"outputs.report","target":"end","targetHandle":"inputs.report","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	require.NotNil(t, res.Result)
	assert.Equal(t, "neutral: Two clear paragraphs.", res.Result["report"],
		"code block should have aggregated both signature outputs")

	for _, id := range []string{"entry", "summarize", "classify", "merge", "end"} {
		node, ok := res.Nodes[id].(map[string]any)
		require.True(t, ok, "missing node %q", id)
		assert.Equal(t, "success", node["status"], "node %q expected success", id)
	}
}

// TestPattern010_CustomNodeFailsWithActionableError pins the contract
// for retired/unsupported node kinds: the engine fails the run with a
// clean error rather than silently producing nothing. This is what
// makes a Studio workflow with a `custom` node *diagnosable* from the
// UI on the FF-on path — operators see a specific instruction telling
// them which kinds are allowed instead of a generic 500. Observed
// customer data shows 4 `custom` instances still in the wild; this
// test ensures the failure is loud + actionable.
//
// Same contract applies to retired `retriever`. The planner-level
// rejection lives in planner_test.go; this test pins the end-to-end
// HTTP surface (Studio JSON in → typed error out via /go/studio/execute_sync).
func TestPattern010_CustomNodeFailsWithActionableError(t *testing.T) {
	url, _ := setupPatternStack(t, &fakeLLMClient{}, func(http.ResponseWriter, *http.Request) {})

	body := `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-010",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3",
	      "name":"Pattern010","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"x","type":"str"}],
	          "dataset":{"inline":{"records":{"x":["v"]},"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"legacy","type":"custom","data":{}},
	        {"id":"end","type":"end","data":{}}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"x","target":"legacy","targetHandle":"x","type":"default"},
	        {"id":"e2","source":"legacy","sourceHandle":"y","target":"end","targetHandle":"y","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "error", res.Status, "custom node must surface as a clean engine error, not silent success")
	require.NotNil(t, res.Error)
	// Error message must be actionable — name the kind AND tell the
	// operator what to replace it with (planner.unsupportedKindMessages
	// supplies the hint).
	assert.Contains(t, res.Error.Message, "custom",
		"error message should name the offending node kind so operators know what to fix")
	assert.Contains(t, res.Error.Message, "replace",
		"error message should include the actionable hint about replacing the node")
}

// TestPattern008_LLMBooleanEvaluator — signature → evaluator with the
// `langevals/llm_boolean` slug → end. This is the dominant evaluator
// shape observed in real customer traffic: a 4-parameter settings dict
// (model + max_tokens + prompt-with-{{var}}-markers), no `categories`.
//
// What this proves:
//
//   1. The evaluator dispatch builds the right URL — slug embeds the
//      langevals/ namespace and path-joins onto /api/evaluations/.
//   2. The full `settings` dict — model, max_tokens, prompt — is sent
//      verbatim to the langevals service. In particular the `{{ var }}`
//      markers in the prompt body are preserved on the wire (they are
//      rendered downstream by langevals, not by us).
//   3. The `data` dict carries upstream signature output + entry-side
//      expected, so the evaluator has both surfaces for its boolean
//      judgement.
//   4. Result.score / Result.passed / Result.details propagate through
//      the engine to the workflow result — the boolean shape callers
//      expect from llm_boolean.
//
// Generic concept (math fact judge); zero customer content.
func TestPattern008_LLMBooleanEvaluator(t *testing.T) {
	llm := &fakeLLMClient{
		respond: func(_ app.LLMRequest) (*app.LLMResponse, error) {
			return &app.LLMResponse{Content: "12", Cost: 0.0001}, nil
		},
	}
	url, lwRequests := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":  "processed",
			"score":   1.0,
			"passed":  true,
			"details": "the candidate answer is numerically correct",
			"cost":    map[string]any{"currency": "USD", "amount": 0.00007},
		})
	})

	body := `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-008",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"sk-pattern-008","spec_version":"1.3",
	      "name":"Pattern008","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[
	            {"identifier":"question","type":"str"},
	            {"identifier":"expected","type":"str"}
	          ],
	          "dataset":{"inline":{"records":{
	            "question":["What is 7+5?"],
	            "expected":["12"]
	          },"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"answer","type":"signature","data":{
	          "name":"Answer",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"Answer with only the digits: {{ question }}"}
	          ],
	          "inputs":[{"identifier":"question","type":"str"}],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"judge","type":"evaluator","data":{
	          "parameters":[
	            {"identifier":"evaluator","type":"str","value":"langevals/llm_boolean"},
	            {"identifier":"name","type":"str","value":"is-answer-correct"},
	            {"identifier":"settings","type":"dict","value":{
	              "model":"openai/gpt-5-mini",
	              "max_tokens":256,
	              "prompt":"Given the question {{ input }} and expected {{ expected_output }}, is the answer {{ output }} correct? Reply true or false."
	            }}
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
	        {"id":"e2","source":"entry","sourceHandle":"outputs.question","target":"judge","targetHandle":"inputs.input","type":"default"},
	        {"id":"e3","source":"answer","sourceHandle":"outputs.answer","target":"judge","targetHandle":"inputs.output","type":"default"},
	        {"id":"e4","source":"entry","sourceHandle":"outputs.expected","target":"judge","targetHandle":"inputs.expected_output","type":"default"},
	        {"id":"e5","source":"judge","sourceHandle":"outputs.score","target":"end","targetHandle":"inputs.score","type":"default"},
	        {"id":"e6","source":"judge","sourceHandle":"outputs.passed","target":"end","targetHandle":"inputs.passed","type":"default"},
	        {"id":"e7","source":"judge","sourceHandle":"outputs.details","target":"end","targetHandle":"inputs.details","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	// (1) URL path embeds the langevals/ namespace — slug path-joins
	// onto /api/evaluations/.
	require.Len(t, *lwRequests, 1, "expected exactly one evaluator HTTP call")
	rec := (*lwRequests)[0]
	assert.Equal(t, "/api/evaluations/langevals/llm_boolean/evaluate", rec["path"])
	assert.Equal(t, "sk-pattern-008", rec["x_auth_token"])

	// (2) settings.{model,max_tokens,prompt} reach langevals verbatim,
	// including the {{ var }} markers in the prompt body. langevals
	// renders them itself; we must not eat them on the way through.
	settings, ok := rec["body"].(map[string]any)["settings"].(map[string]any)
	require.True(t, ok, "evaluator request must carry a settings object")
	assert.Equal(t, "openai/gpt-5-mini", settings["model"])
	assert.InDelta(t, 256.0, settings["max_tokens"], 1e-9)
	prompt, _ := settings["prompt"].(string)
	assert.Contains(t, prompt, "{{ input }}",
		"settings.prompt must preserve {{ var }} markers — langevals renders them")
	assert.Contains(t, prompt, "{{ expected_output }}")
	assert.Contains(t, prompt, "{{ output }}")
	assert.NotContains(t, settings, "categories",
		"llm_boolean settings must NOT carry a categories field")

	// (3) data dict carries both upstream signature output AND entry-side
	// expected — the boolean evaluator needs both surfaces.
	data := rec["body"].(map[string]any)["data"].(map[string]any)
	assert.Equal(t, "What is 7+5?", data["input"])
	assert.Equal(t, "12", data["output"], "signature output must reach evaluator data.output")
	assert.Equal(t, "12", data["expected_output"])

	// (4) score / passed / details surface through to the workflow result.
	require.NotNil(t, res.Result)
	assert.InDelta(t, 1.0, res.Result["score"], 1e-9)
	assert.Equal(t, true, res.Result["passed"])
	assert.Equal(t, "the candidate answer is numerically correct", res.Result["details"])
}

// TestPattern009_LLMCategoryEvaluator — signature → evaluator with the
// `langevals/llm_category` slug → end. Same shape as pattern_008 plus
// the `categories` array — `[{name, description}, ...]`. This is the
// second-most-common evaluator pattern observed in real traffic.
//
// What this proves on top of pattern_008:
//
//   1. settings.categories survives the JSON boundary as a list of
//      objects with `name` and `description` keys preserved (no
//      flattening to bare strings).
//   2. The evaluator returns a `label` (which category matched) and the
//      engine surfaces it to result.label — the field shape that
//      langevals/llm_category callers depend on, distinct from the
//      score/passed shape of llm_boolean.
//
// Generic concept (weather severity classifier judge); zero customer
// content.
func TestPattern009_LLMCategoryEvaluator(t *testing.T) {
	llm := &fakeLLMClient{
		respond: func(_ app.LLMRequest) (*app.LLMResponse, error) {
			return &app.LLMResponse{Content: "mild"}, nil
		},
	}
	url, lwRequests := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":  "processed",
			"label":   "mild",
			"details": "the description matches the mild category most closely",
			"cost":    map[string]any{"currency": "USD", "amount": 0.00009},
		})
	})

	body := `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-009",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"sk-pattern-009","spec_version":"1.3",
	      "name":"Pattern009","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"observation","type":"str"}],
	          "dataset":{"inline":{"records":{
	            "observation":["A pleasant afternoon with a high of 22C and a light breeze."]
	          },"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"classify","type":"signature","data":{
	          "name":"Classify",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini","litellm_params":{"api_key":"k"}}},
	            {"identifier":"instructions","type":"str","value":"Describe the severity of: {{ observation }}"}
	          ],
	          "inputs":[{"identifier":"observation","type":"str"}],
	          "outputs":[{"identifier":"verdict","type":"str"}]
	        }},
	        {"id":"judge","type":"evaluator","data":{
	          "parameters":[
	            {"identifier":"evaluator","type":"str","value":"langevals/llm_category"},
	            {"identifier":"name","type":"str","value":"severity-bucket"},
	            {"identifier":"settings","type":"dict","value":{
	              "model":"openai/gpt-5-mini",
	              "max_tokens":128,
	              "prompt":"Given the observation {{ input }} and the verdict {{ output }}, pick the matching category.",
	              "categories":[
	                {"name":"extreme","description":"dangerous conditions, advisories likely"},
	                {"name":"mild","description":"unremarkable, comfortable conditions"},
	                {"name":"normal","description":"typical seasonal conditions, no advisories"}
	              ]
	            }}
	          ],
	          "outputs":[
	            {"identifier":"label","type":"str"},
	            {"identifier":"details","type":"str"}
	          ]
	        }},
	        {"id":"end","type":"end","data":{"inputs":[
	          {"identifier":"label","type":"str"},
	          {"identifier":"details","type":"str"}
	        ]}}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.observation","target":"classify","targetHandle":"inputs.observation","type":"default"},
	        {"id":"e2","source":"entry","sourceHandle":"outputs.observation","target":"judge","targetHandle":"inputs.input","type":"default"},
	        {"id":"e3","source":"classify","sourceHandle":"outputs.verdict","target":"judge","targetHandle":"inputs.output","type":"default"},
	        {"id":"e4","source":"judge","sourceHandle":"outputs.label","target":"end","targetHandle":"inputs.label","type":"default"},
	        {"id":"e5","source":"judge","sourceHandle":"outputs.details","target":"end","targetHandle":"inputs.details","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	require.Len(t, *lwRequests, 1, "expected exactly one evaluator HTTP call")
	rec := (*lwRequests)[0]
	assert.Equal(t, "/api/evaluations/langevals/llm_category/evaluate", rec["path"])

	// (1) settings.categories — slice of {name, description} objects,
	// preserved verbatim. Crucial: no flattening to bare strings.
	settings := rec["body"].(map[string]any)["settings"].(map[string]any)
	categoriesAny, ok := settings["categories"].([]any)
	require.True(t, ok, "settings.categories must be a list, got %T", settings["categories"])
	require.Len(t, categoriesAny, 3, "expected 3 categories in settings")
	for _, c := range categoriesAny {
		entry, ok := c.(map[string]any)
		require.True(t, ok, "each category entry must be an object, got %T", c)
		assert.NotEmpty(t, entry["name"], "category.name must be present")
		assert.NotEmpty(t, entry["description"], "category.description must be present")
	}

	// (2) label surfaces through to the workflow result — the shape
	// langevals/llm_category callers depend on (distinct from
	// score/passed for llm_boolean).
	require.NotNil(t, res.Result)
	assert.Equal(t, "mild", res.Result["label"])
	assert.Equal(t, "the description matches the mild category most closely", res.Result["details"])
}

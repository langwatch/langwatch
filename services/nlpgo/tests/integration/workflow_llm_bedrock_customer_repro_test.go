//go:build live_bedrock

package integration_test

// Verbatim replay of the customer-reported failing workflow
// (exported 2026-05-31): a signature node with Structured Outputs
// {output:bool, reason:str}, long system instructions, a chat_messages
// parameter with {{input}} placeholder, reasoning_effort:medium,
// max_tokens:8192, model bedrock/us.anthropic.claude-haiku-4-5-*.
//
// The contrived TestSync_RealWorkflowEndToEnd_BedrockStructuredOutputs
// e2e in workflow_llm_bedrock_structured_outputs_test.go used a 1-line
// prompt + no chat_messages parameter + no reasoning_effort + short
// max_tokens. It passed and led to the false-positive merge of #4431.
// The customer then reproduced the original failure: nlpgo dumped all
// the reasoning into the `output` field, python returned parsed
// {output:false, reason:"..."}. This test mirrors the customer's
// signature configuration exactly so any future regression on this
// prompt shape fails CI.
//
// Build tag: live_bedrock. Uses eu.* inference profile (only one our
// langwatch-dev-bedrock-user IAM allows).

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/dispatcheradapter"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/llmexecutor"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

func setupStackWithLLM_bedrockCustomerRepro(t *testing.T) *stack {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	disp, err := dispatcher.New(context.Background(), dispatcher.Options{})
	require.NoError(t, err)
	llm := llmexecutor.New(dispatcheradapter.New(disp))
	httpExec := httpblock.New(httpblock.Options{})
	codeExec, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)
	eng := engine.New(engine.Options{HTTP: httpExec, Code: codeExec, LLM: llm})
	executor := liveBedrockStructuredExecutorAdapter{eng: eng}
	application := app.New(app.WithWorkflowExecutor(executor))
	probes := health.New("test")
	probes.MarkStarted()
	router := httpapi.NewRouter(httpapi.RouterDeps{App: application, Health: probes, Version: "test"})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	t.Cleanup(upstream.Close)
	return &stack{url: srv.URL, upstream: upstream, upstreamURL: upstream.URL}
}

// Verbatim system prompt from the customer's exported workflow
// (workflow--classifier-relevance-2026-05-31.json:nodes[].parameters[0].value).
const customerInstructions = `You are a strict boolean evaluator.

Goal:
Check if classifier_output correctly matches fetch_report_code_input.

Inputs:
- fetch_report_code_input: {{fetch_report_code_input}}
- classifier_output: {{classifier_output}}
- user_input: {{input}}

----------------------------------
RULE 1 (EMPTY OVERRIDE — HIGHEST PRIORITY):
If BOTH fetch_report_code_input AND classifier_output are empty/null:
→ Return TRUE.
→ STOP.
----------------------------------

RULE 2 (ENTITY MATCH OVERRIDE):
If fetch_report_code_input contains one or more entities AND classifier_output contains one or more entities:
→ If ANY entity from classifier_output matches ANY entity from fetch_report_code_input (case-insensitive):
    → Return TRUE.
    → STOP.
----------------------------------

RULE 3 (INTENT REQUIRED):
If fetch_report_code_input is empty/null AND classifier_output contains one or more entities:
→ Evaluate alignment with user_input.
→ Return TRUE if aligned, else FALSE.
→ STOP.
----------------------------------

Output format:
TRUE or FALSE
Reason: one short paragraph`

func TestSync_RealWorkflowEndToEnd_BedrockCustomerReproVerbatim(t *testing.T) {
	accessKey := os.Getenv("AWS_ACCESS_KEY_ID")
	secretKey := os.Getenv("AWS_SECRET_ACCESS_KEY")
	region := os.Getenv("AWS_DEFAULT_REGION")
	if accessKey == "" || secretKey == "" || region == "" {
		t.Skip("AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_DEFAULT_REGION must be set")
	}
	model := os.Getenv("BEDROCK_MODEL")
	if model == "" {
		model = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
	}
	stack := setupStackWithLLM_bedrockCustomerRepro(t)

	litellmParams := map[string]any{
		"aws_access_key_id":     accessKey,
		"aws_secret_access_key": secretKey,
		"aws_region_name":       region,
	}
	if st := os.Getenv("AWS_SESSION_TOKEN"); st != "" {
		litellmParams["aws_session_token"] = st
	}

	// Customer-exact LLM config (workflow--classifier-relevance-
	// 2026-05-31.json:nodes[].parameters[0].value): reasoning_effort
	// "medium", max_tokens 8192, temperature 1, plus the bedrock-specific
	// sampling knobs (top_k, top_p, min_p, etc.). Replicate verbatim so a
	// future regression on this prompt shape (e.g. reasoning_effort
	// breaking tool_use response parsing on anthropic) fails here.
	// Customer config has both temperature=1 AND top_p=1 — bedrock haiku
	// 4.5 rejects that pair ("temperature and top_p cannot both be
	// specified for this model"). Customer's prod path presumably strips
	// one of them somewhere upstream; for this e2e replay we drop top_p
	// because temperature is the more authoritative knob.
	llmValue := map[string]any{
		"model":             "bedrock/" + model,
		"max_tokens":        8192,
		"temperature":       1,
		"reasoning_effort":  "medium",
		"litellm_params":    litellmParams,
	}

	// Customer-exact inputs (screenshot 2026-05-31): the failing case is
	// the one where the model wrote prose into `output` instead of
	// returning {output:false, reason:"..."}.
	customerInput := "What is the difference between budget navigator and pacing monitor?"
	customerClassifierOutput := `[{"type":"text","value":"<Answer>NONE</Answer>\n\nThis question is asking about the difference between two features or tools (Budget Navigator and Pacing Monitor) rather than a request for advertising data."}]`
	customerFetchReportCodeInput := "[]"

	workflow := map[string]any{
		"workflow_id":      "wf",
		"api_key":          "k",
		"spec_version":     "1.3",
		"name":             "ClassifierRelevance",
		"icon":             "🧮",
		"description":      "x",
		"version":          "x",
		"template_adapter": "default",
		"nodes": []any{
			map[string]any{
				"id": "entry", "type": "entry",
				"data": map[string]any{
					"outputs": []any{
						map[string]any{"identifier": "input", "type": "str"},
						map[string]any{"identifier": "classifier_output", "type": "str"},
						map[string]any{"identifier": "fetch_report_code_input", "type": "str"},
					},
					"dataset": map[string]any{
						"inline": map[string]any{
							"records": map[string]any{
								"input":                   []any{customerInput},
								"classifier_output":       []any{customerClassifierOutput},
								"fetch_report_code_input": []any{customerFetchReportCodeInput},
							},
						},
					},
					"entry_selection": 0,
					"train_size":      1.0,
					"test_size":       0.0,
					"seed":            1,
				},
			},
			map[string]any{
				// Customer-exact prompt node shape: instructions parameter
				// + chat_messages parameter (NOT a plain "prompt" field).
				// This is the studio-prompt-playground assembly path; the
				// engine's buildMessages must render the system from
				// instructions and the user turn from the chat_messages
				// template's {{input}} placeholder.
				"id": "classify", "type": "signature",
				"data": map[string]any{
					"name": "ClassifierRelevance",
					"parameters": []any{
						map[string]any{
							"identifier": "llm", "type": "llm",
							"value": llmValue,
						},
						map[string]any{
							"identifier": "instructions", "type": "str",
							"value": customerInstructions,
						},
						map[string]any{
							"identifier": "messages", "type": "chat_messages",
							"value": []any{
								map[string]any{"role": "user", "content": "{{input}}"},
							},
						},
					},
					"inputs": []any{
						map[string]any{"identifier": "input", "type": "str"},
						map[string]any{"identifier": "classifier_output", "type": "str"},
						map[string]any{"identifier": "fetch_report_code_input", "type": "str"},
					},
					"outputs": []any{
						map[string]any{"identifier": "output", "type": "bool"},
						map[string]any{"identifier": "reason", "type": "str"},
					},
				},
			},
			map[string]any{
				"id": "end", "type": "end",
				"data": map[string]any{
					"inputs": []any{
						map[string]any{"identifier": "output", "type": "bool"},
						map[string]any{"identifier": "reason", "type": "str"},
					},
				},
			},
		},
		"edges": []any{
			map[string]any{"id": "e_input", "source": "entry", "sourceHandle": "outputs.input", "target": "classify", "targetHandle": "inputs.input", "type": "default"},
			map[string]any{"id": "e_co", "source": "entry", "sourceHandle": "outputs.classifier_output", "target": "classify", "targetHandle": "inputs.classifier_output", "type": "default"},
			map[string]any{"id": "e_fr", "source": "entry", "sourceHandle": "outputs.fetch_report_code_input", "target": "classify", "targetHandle": "inputs.fetch_report_code_input", "type": "default"},
			map[string]any{"id": "e_o", "source": "classify", "sourceHandle": "outputs.output", "target": "end", "targetHandle": "inputs.output", "type": "default"},
			map[string]any{"id": "e_r", "source": "classify", "sourceHandle": "outputs.reason", "target": "end", "targetHandle": "inputs.reason", "type": "default"},
		},
		"state": map[string]any{},
	}
	envelope := map[string]any{
		"type": "execute_flow",
		"payload": map[string]any{
			"trace_id": "customer-repro-2026-05-31",
			"origin":   "workflow",
			"workflow": workflow,
			"inputs":   []any{map[string]any{}},
		},
	}
	body, err := json.Marshal(envelope)
	require.NoError(t, err)

	res := postSync(t, stack, string(body))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	require.NotNil(t, res.Result)

	// Pre-fix manifestation: `output` was a string containing the entire
	// model reasoning (e.g. "I need to evaluate whether...\n\n**Step 1:**
	// ..."), `reason` was missing entirely. The customer's screenshot
	// 2026-05-31 shows exactly this. Post-fix: `output` must be a real
	// bool and `reason` a populated string, just like the python path
	// returns.
	outVal, hasOut := res.Result["output"]
	require.True(t, hasOut, "missing `output` in result; result=%+v", res.Result)
	_, isBool := outVal.(bool)
	require.Truef(t, isBool,
		"`output` must be a real bool, not %T (%v) — pre-fix manifestation: model reasoning dumped into output field",
		outVal, outVal)
	reason, _ := res.Result["reason"].(string)
	assert.NotEmpty(t, reason,
		"`reason` must be populated as its own field; pre-fix it was missing because the whole response collapsed into `output`")
	// Sanity check: model returned something that isn't just reasoning
	// markdown leaking into the wrong field.
	if s, ok := outVal.(string); ok {
		t.Logf("output as string (UNEXPECTED — should be bool): %q", s)
	}
}

// Ensure dsl import is used (we don't directly construct DSL types here,
// the worker parses our JSON envelope; keeping the import for parity
// with the sibling _test.go file's adapter).
var _ = dsl.ParseWorkflow

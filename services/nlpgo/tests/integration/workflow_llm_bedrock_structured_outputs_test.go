//go:build live_bedrock

package integration_test

// Bedrock + Anthropic structured-outputs e2e. Reproduces the rchaves
// 2026-05-30 prompt-registry dogfood: a signature with two outputs
// (`output: bool` + `reason: str`) bound to a Bedrock Anthropic Haiku
// 4.5 inference profile must come back as parsed JSON, not raw prose.
//
// Python langwatch_nlp returns `{output: true, reason: "..."}` via
// LiteLLM (tool_use forced choice). The Go path was returning raw
// `TRUE\n\nReason: ...` prose because bifrost v1.4.22 routes
// response_format on bedrock+anthropic through Anthropic's native
// output_config.format extension (providers/bedrock/utils.go:1011-1015)
// without injecting the required anthropic-beta header — Bedrock
// silently ignores the field and the model returns prose.
//
// Build tag: live_bedrock (gated; needs AWS_ACCESS_KEY_ID +
// AWS_SECRET_ACCESS_KEY + AWS_DEFAULT_REGION in env).

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

func setupStackWithLLM_bedrockStructured(t *testing.T) *stack {
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

type liveBedrockStructuredExecutorAdapter struct{ eng *engine.Engine }

func (a liveBedrockStructuredExecutorAdapter) ExecuteStream(ctx context.Context, req app.WorkflowRequest, opts app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
	wf, err := dsl.ParseWorkflow(req.WorkflowJSON)
	if err != nil {
		ch := make(chan app.WorkflowStreamEvent, 1)
		ch <- app.WorkflowStreamEvent{Type: "error", Payload: map[string]any{"message": err.Error()}}
		close(ch)
		return ch, nil
	}
	in, err := a.eng.ExecuteStream(ctx, engine.ExecuteRequest{
		Workflow: wf, Inputs: req.Inputs, Origin: req.Origin, TraceID: req.TraceID,
	}, engine.ExecuteStreamOptions{Heartbeat: opts.Heartbeat})
	if err != nil {
		ch := make(chan app.WorkflowStreamEvent, 1)
		ch <- app.WorkflowStreamEvent{Type: "error", Payload: map[string]any{"message": err.Error()}}
		close(ch)
		return ch, nil
	}
	out := make(chan app.WorkflowStreamEvent, 16)
	go func() {
		defer close(out)
		for ev := range in {
			out <- app.WorkflowStreamEvent{Type: ev.Type, TraceID: ev.TraceID, Payload: ev.Payload}
		}
	}()
	return out, nil
}

func (a liveBedrockStructuredExecutorAdapter) Execute(ctx context.Context, req app.WorkflowRequest) (*app.WorkflowResult, error) {
	wf, err := dsl.ParseWorkflow(req.WorkflowJSON)
	if err != nil {
		return &app.WorkflowResult{Status: "error", Error: &app.WorkflowError{Type: "invalid_workflow", Message: err.Error()}}, nil
	}
	res, err := a.eng.Execute(ctx, engine.ExecuteRequest{
		Workflow: wf, Inputs: req.Inputs, Origin: req.Origin, TraceID: req.TraceID,
	})
	if err != nil {
		return &app.WorkflowResult{Status: "error", Error: &app.WorkflowError{Type: "engine_error", Message: err.Error()}}, nil
	}
	out := &app.WorkflowResult{TraceID: res.TraceID, Status: res.Status, Result: res.Result}
	if res.Error != nil {
		out.Error = &app.WorkflowError{NodeID: res.Error.NodeID, Type: res.Error.Type, Message: res.Error.Message}
	}
	if len(res.Nodes) > 0 {
		out.Nodes = make(map[string]any, len(res.Nodes))
		for k, v := range res.Nodes {
			out.Nodes[k] = v
		}
	}
	return out, nil
}

// @scenario bedrock + anthropic response_format rewrites to forced tool_use
func TestSync_RealWorkflowEndToEnd_BedrockStructuredOutputs(t *testing.T) {
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
	stack := setupStackWithLLM_bedrockStructured(t)

	litellmParams := map[string]any{
		"aws_access_key_id":     accessKey,
		"aws_secret_access_key": secretKey,
		"aws_region_name":       region,
	}
	if st := os.Getenv("AWS_SESSION_TOKEN"); st != "" {
		litellmParams["aws_session_token"] = st
	}

	workflow := map[string]any{
		"workflow_id":      "wf",
		"api_key":          "k",
		"spec_version":     "1.3",
		"name":             "BedrockClassifier",
		"icon":             "🧮",
		"description":      "x",
		"version":          "x",
		"template_adapter": "default",
		"nodes": []any{
			map[string]any{
				"id": "entry", "type": "entry",
				"data": map[string]any{
					"outputs": []any{map[string]any{"identifier": "question", "type": "str"}},
					"dataset": map[string]any{
						"inline": map[string]any{
							"records": map[string]any{"question": []any{"Is 8 plus 8 equal to 16?"}},
						},
					},
					"entry_selection": 0,
					"train_size":      1.0,
					"test_size":       0.0,
					"seed":            1,
				},
			},
			map[string]any{
				"id": "classify", "type": "signature",
				"data": map[string]any{
					"name": "Classify",
					"parameters": []any{map[string]any{
						"identifier": "llm", "type": "llm",
						"value": map[string]any{
							"model":          "bedrock/" + model,
							"litellm_params": litellmParams,
						},
					}},
					"inputs": []any{map[string]any{"identifier": "question", "type": "str"}},
					// Two outputs — bool + str — exactly matching the rchaves
					// dogfood: Structured Outputs ON, fields {output: bool,
					// reason: str}. Triggers signatureNeedsStructuredOutput
					// → response_format → bifrost bedrock+anthropic path.
					"outputs": []any{
						map[string]any{"identifier": "output", "type": "bool"},
						map[string]any{"identifier": "reason", "type": "str"},
					},
					"prompt": "Answer with structured output. Is the statement in {{question}} correct?",
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
			map[string]any{"id": "e1", "source": "entry", "sourceHandle": "outputs.question", "target": "classify", "targetHandle": "inputs.question", "type": "default"},
			map[string]any{"id": "e2", "source": "classify", "sourceHandle": "outputs.output", "target": "end", "targetHandle": "inputs.output", "type": "default"},
			map[string]any{"id": "e3", "source": "classify", "sourceHandle": "outputs.reason", "target": "end", "targetHandle": "inputs.reason", "type": "default"},
		},
		"state": map[string]any{},
	}
	envelope := map[string]any{
		"type": "execute_flow",
		"payload": map[string]any{
			"trace_id": "real-e2e-bedrock-structured",
			"origin":   "workflow",
			"workflow": workflow,
			"inputs":   []any{map[string]any{}},
		},
	}
	body, err := json.Marshal(envelope)
	require.NoError(t, err)

	res := postSync(t, stack, string(body))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	// The fix: `output` must come back as a real JSON boolean, and
	// `reason` as a non-empty string. Pre-fix the engine fell through
	// recoverJSONObject's "did not parse as a JSON object" branch and
	// dumped the model's raw prose into the first declared field
	// (`output`) as a string. We assert (a) `output` is a bool with
	// the right value, and (b) `reason` is populated separately —
	// either condition fails if the prose-fallback fires.
	require.NotNil(t, res.Result)
	outVal, hasOut := res.Result["output"]
	require.True(t, hasOut, "missing `output` in result; result=%+v", res.Result)
	gotBool, ok := outVal.(bool)
	require.Truef(t, ok, "`output` must be a real bool, not %T (%v) — prose fallback fired", outVal, outVal)
	assert.True(t, gotBool, "8+8=16 is true; got false")
	reason, _ := res.Result["reason"].(string)
	assert.NotEmpty(t, reason, "`reason` must be populated as its own field, not merged into `output`")
}

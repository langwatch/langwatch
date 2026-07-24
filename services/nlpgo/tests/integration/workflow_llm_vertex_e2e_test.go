//go:build live_vertex

package integration_test

// Google Vertex AI counterpart to the OpenAI / Anthropic / Gemini /
// Azure / Bedrock live e2es. Closes the third "tricky enterprise"
// provider per the brief. Vertex is the most complex of the inline-
// credential paths because the credential is a service-account JSON
// blob (read from GOOGLE_APPLICATION_CREDENTIALS) carried inside the
// workflow's litellm_params alongside vertex_project + vertex_location.
//
// Build tag: live_vertex (gated; needs GOOGLE_APPLICATION_CREDENTIALS
// + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION). Body assembled via
// encoding/json (not string concat) so the SA JSON's nested escapes
// don't fight string interpolation.

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

func setupStackWithLLM_vertex(t *testing.T) *stack {
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
	executor := liveVertexExecutorAdapter{eng: eng}
	application := app.New(app.WithWorkflowExecutor(executor))
	probes := health.New("test")
	probes.MarkStarted()
	router := httpapi.NewRouter(httpapi.RouterDeps{App: application, Health: probes, Version: "test"})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	t.Cleanup(upstream.Close)
	return &stack{url: srv.URL, upstream: upstream, upstreamURL: upstream.URL}
}

type liveVertexExecutorAdapter struct{ eng *engine.Engine }

func (a liveVertexExecutorAdapter) ExecuteStream(ctx context.Context, req app.WorkflowRequest, opts app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
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

func (a liveVertexExecutorAdapter) Execute(ctx context.Context, req app.WorkflowRequest) (*app.WorkflowResult, error) {
	wf, err := dsl.ParseWorkflow(req.WorkflowJSON)
	if err != nil {
		return &app.WorkflowResult{
			Status: "error",
			Error:  &app.WorkflowError{Type: "invalid_workflow", Message: err.Error()},
		}, nil
	}
	res, err := a.eng.Execute(ctx, engine.ExecuteRequest{
		Workflow: wf, Inputs: req.Inputs, Origin: req.Origin, TraceID: req.TraceID,
	})
	if err != nil {
		return &app.WorkflowResult{
			Status: "error",
			Error:  &app.WorkflowError{Type: "engine_error", Message: err.Error()},
		}, nil
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

func TestSync_RealWorkflowEndToEnd_Vertex(t *testing.T) {
	saPath := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	project := os.Getenv("GOOGLE_CLOUD_PROJECT")
	location := os.Getenv("GOOGLE_CLOUD_LOCATION")
	if saPath == "" || project == "" || location == "" {
		t.Skip("GOOGLE_APPLICATION_CREDENTIALS + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION must be set")
	}
	saJSON, err := os.ReadFile(saPath)
	require.NoError(t, err, "read service-account JSON at %s", saPath)
	model := os.Getenv("VERTEX_MODEL")
	if model == "" {
		model = "gemini-2.5-flash"
	}
	stack := setupStackWithLLM_vertex(t)

	// Build the workflow body via encoding/json so the SA JSON's
	// nested string escapes don't fight string interpolation.
	workflow := map[string]any{
		"workflow_id":      "wf",
		"api_key":          "k",
		"spec_version":     "1.3",
		"name":             "VertexMath",
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
							"records": map[string]any{"question": []any{"What is 4+4? Reply with just the digit."}},
						},
					},
					"entry_selection": 0,
					"train_size":      1.0,
					"test_size":       0.0,
					"seed":            1,
				},
			},
			map[string]any{
				"id": "answer", "type": "signature",
				"data": map[string]any{
					"name": "Answer",
					"parameters": []any{map[string]any{
						"identifier": "llm", "type": "llm",
						"value": map[string]any{
							"model": "vertex_ai/" + model,
							"litellm_params": map[string]any{
								"vertex_credentials": string(saJSON),
								"vertex_project":     project,
								"vertex_location":    location,
							},
						},
					}},
					"inputs":  []any{map[string]any{"identifier": "question", "type": "str"}},
					"outputs": []any{map[string]any{"identifier": "answer", "type": "str"}},
				},
			},
			map[string]any{
				"id": "end", "type": "end",
				"data": map[string]any{
					"inputs": []any{map[string]any{"identifier": "answer", "type": "str"}},
				},
			},
		},
		"edges": []any{
			map[string]any{"id": "e1", "source": "entry", "sourceHandle": "outputs.question", "target": "answer", "targetHandle": "inputs.question", "type": "default"},
			map[string]any{"id": "e2", "source": "answer", "sourceHandle": "outputs.answer", "target": "end", "targetHandle": "inputs.answer", "type": "default"},
		},
		"state": map[string]any{},
	}
	envelope := map[string]any{
		"type": "execute_flow",
		"payload": map[string]any{
			"trace_id": "real-e2e-vertex",
			"origin":   "workflow",
			"workflow": workflow,
			"inputs":   []any{map[string]any{}},
		},
	}
	body, err := json.Marshal(envelope)
	require.NoError(t, err)

	res := postSync(t, stack, string(body))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.Equal(t, "real-e2e-vertex", res.TraceID)

	answer, _ := res.Result["answer"].(string)
	require.NotEmpty(t, answer, "expected non-empty answer from real Vertex call")
	// 4+4=8 — tightened from "any digit" so a wrong-but-numeric reply
	// doesn't silently mask a regression in prompt rendering or model
	// dispatch (matches the OpenAI/Anthropic e2e pattern).
	assert.Contains(t, answer, "8",
		"expected the answer to contain the digit 8, got %q", answer)

	require.NotNil(t, res.Nodes)
	for _, id := range []string{"entry", "answer", "end"} {
		node, ok := res.Nodes[id].(map[string]any)
		require.True(t, ok, "missing node %q in result.nodes", id)
		assert.Equal(t, "success", node["status"])
	}
}

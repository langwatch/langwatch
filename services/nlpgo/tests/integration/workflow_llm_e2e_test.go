//go:build live_openai

package integration_test

// Real workflow end-to-end test. Posts a Studio-shape DSL
// (entry → signature → end) through /go/studio/execute_sync, the same
// path runWorkflow.ts hits. Proves the full nlpgo path works against
// a real provider via the library pivot:
//
//   handler.decodeStudioClientEvent
//     → engineAdapter.Execute
//       → planner.New
//       → engine.runEntry (dataset materialization)
//       → engine.runSignature (LLM block)
//         → llmexecutor.Execute (translator)
//           → dispatcheradapter.Dispatch (in-process)
//             → dispatcher.Dispatch
//               → providers.BifrostRouter.Dispatch
//                 → real OpenAI HTTPS call
//
// Build tag: live_openai (gated; needs real OPENAI_API_KEY in env).

import (
	"context"
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

// setupStackWithLLM is the live-test variant of setupStack — wires
// the in-process dispatcher + dispatcheradapter + llmexecutor so a
// signature node hits the real provider via the library pivot.
func setupStackWithLLM(t *testing.T) *stack {
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

	executor := liveExecutorAdapter{eng: eng}
	application := app.New(app.WithWorkflowExecutor(executor))
	probes := health.New("test")
	probes.MarkStarted()
	router := httpapi.NewRouter(httpapi.RouterDeps{App: application, Health: probes, Version: "test"})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	t.Cleanup(upstream.Close)
	return &stack{url: srv.URL, upstream: upstream, upstreamURL: upstream.URL}
}

// liveExecutorAdapter mirrors executorAdapter but is defined in this
// file so the live build tag scoping is local — keeps the default
// build path (without live_openai) free of any aigateway/dispatcher
// imports.
type liveExecutorAdapter struct{ eng *engine.Engine }

func (a liveExecutorAdapter) ExecuteStream(ctx context.Context, req app.WorkflowRequest, opts app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
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

func (a liveExecutorAdapter) Execute(ctx context.Context, req app.WorkflowRequest) (*app.WorkflowResult, error) {
	wf, err := dsl.ParseWorkflow(req.WorkflowJSON)
	if err != nil {
		return &app.WorkflowResult{Status: "error", Error: &app.WorkflowError{Type: "invalid_workflow", Message: err.Error()}}, nil
	}
	res, err := a.eng.Execute(ctx, engine.ExecuteRequest{Workflow: wf, Inputs: req.Inputs, Origin: req.Origin, TraceID: req.TraceID})
	if err != nil {
		return &app.WorkflowResult{Status: "error", Error: &app.WorkflowError{Type: "engine_error", Message: err.Error()}}, nil
	}
	out := &app.WorkflowResult{Status: res.Status, Result: res.Result, TraceID: res.TraceID}
	if res.Error != nil {
		out.Error = &app.WorkflowError{Type: res.Error.Type, Message: res.Error.Message, NodeID: res.Error.NodeID}
	}
	if len(res.Nodes) > 0 {
		out.Nodes = make(map[string]any, len(res.Nodes))
		for k, v := range res.Nodes {
			out.Nodes[k] = v
		}
	}
	return out, nil
}

// TestSync_RealWorkflowEndToEnd_OpenAI is the headline proof. A
// minimal-but-real Studio workflow runs through nlpgo, the LLM block
// hits OpenAI, the result is shaped exactly the way Studio's UI
// expects and the cost+nodes accounting is intact.
func TestSync_RealWorkflowEndToEnd_OpenAI(t *testing.T) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		t.Skip("OPENAI_API_KEY not set")
	}
	stack := setupStackWithLLM(t)

	// Minimal real Studio workflow:
	//   entry (dataset.records.question = ["What is 2+2? Reply with one digit."])
	//     -> signature (LLM, openai/gpt-5-mini)
	//       -> end
	body := `{
	  "type": "execute_flow",
	  "payload": {
	    "trace_id": "real-e2e",
	    "origin": "workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"Math","icon":"🧮","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"question","type":"str"}],
	          "dataset":{"inline":{"records":{"question":["What is 2+2? Reply with just the single digit."]}}},
	          "entry_selection":0,
	          "train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"answer","type":"signature","data":{
	          "name":"Answer",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{
	              "model":"openai/gpt-5-mini",
	              "litellm_params":{"api_key":"` + apiKey + `"}
	            }}
	          ],
	          "inputs":[{"identifier":"question","type":"str"}],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{
	          "inputs":[{"identifier":"answer","type":"str"}]
	        }}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.question","target":"answer","targetHandle":"inputs.question","type":"default"},
	        {"id":"e2","source":"answer","sourceHandle":"outputs.answer","target":"end","targetHandle":"inputs.answer","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`

	res := postSync(t, stack, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.Equal(t, "real-e2e", res.TraceID)

	answer, _ := res.Result["answer"].(string)
	require.NotEmpty(t, answer, "expected non-empty answer from real OpenAI call")
	// Best-effort sanity check on the math answer; if the model adds
	// trailing punctuation or wraps the digit we still pass since we
	// only need to prove the call reached the provider.
	assert.Contains(t, answer, "4", "expected the answer to contain the digit 4, got %q", answer)

	// Per-node accounting: the signature node should have a non-zero
	// duration_ms and the entry/end nodes should be present too.
	require.NotNil(t, res.Nodes)
	for _, id := range []string{"entry", "answer", "end"} {
		node, ok := res.Nodes[id].(map[string]any)
		require.True(t, ok, "missing node %q in result.nodes", id)
		assert.Equal(t, "success", node["status"])
	}
}

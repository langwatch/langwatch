//go:build live_anthropic

package integration_test

// Anthropic counterpart to TestSync_RealWorkflowEndToEnd_OpenAI. Same
// chain, different provider — proves the credential mapping +
// dispatch path works for Anthropic specifically when a real customer
// workflow is configured with `anthropic/<model>`. Owner explicitly
// flagged Anthropic alongside OpenAI as a top-priority provider in
// the migration brief.
//
// Build tag: live_anthropic (gated; needs real ANTHROPIC_API_KEY).
// Setup is duplicated (rather than shared with the OpenAI file) so
// the default build path stays free of any aigateway/dispatcher
// imports — same rationale as workflow_llm_e2e_test.go.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
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

func setupStackWithLLM_anthropic(t *testing.T) *stack {
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

	executor := liveAnthropicExecutorAdapter{eng: eng}
	application := app.New(app.WithWorkflowExecutor(executor))
	probes := health.New("test")
	probes.MarkStarted()
	router := httpapi.NewRouter(httpapi.RouterDeps{App: application, Health: probes, Version: "test"})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	t.Cleanup(upstream.Close)
	return &stack{url: srv.URL, upstream: upstream, upstreamURL: upstream.URL}
}

type liveAnthropicExecutorAdapter struct{ eng *engine.Engine }

func (a liveAnthropicExecutorAdapter) ExecuteStream(ctx context.Context, req app.WorkflowRequest, opts app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
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

func (a liveAnthropicExecutorAdapter) Execute(ctx context.Context, req app.WorkflowRequest) (*app.WorkflowResult, error) {
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

// TestSync_RealWorkflowEndToEnd_Anthropic is the Anthropic sibling of
// the OpenAI headline. Same minimal Studio workflow, different model
// id — the dispatcheradapter must translate the inline-creds payload
// onto the right BifrostRouter provider so an `anthropic/<model>`
// signature node lands on Anthropic, not OpenAI.
func TestSync_RealWorkflowEndToEnd_Anthropic(t *testing.T) {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		t.Skip("ANTHROPIC_API_KEY not set")
	}
	stack := setupStackWithLLM_anthropic(t)

	body := `{
	  "type": "execute_flow",
	  "payload": {
	    "trace_id": "real-e2e-anthropic",
	    "origin": "workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"AnthropicMath","icon":"🧮","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"question","type":"str"}],
	          "dataset":{"inline":{"records":{"question":["What is 5+5? Reply with just the single digit."]}}},
	          "entry_selection":0,
	          "train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"answer","type":"signature","data":{
	          "name":"Answer",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{
	              "model":"anthropic/claude-haiku-4-5",
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
	assert.Equal(t, "real-e2e-anthropic", res.TraceID)

	answer, _ := res.Result["answer"].(string)
	require.NotEmpty(t, answer, "expected non-empty answer from real Anthropic call")
	// Loose check — Anthropic models often wrap single-digit answers
	// with "10" or extra whitespace. We only need to prove the call
	// reached the provider and a digit came back.
	assert.True(t, strings.ContainsAny(answer, "0123456789"),
		"expected a digit in the answer, got %q", answer)

	// Per-node accounting: signature node should be present and
	// successful. Cost may be zero if Anthropic's response didn't
	// include usage; that's a separate concern.
	require.NotNil(t, res.Nodes)
	for _, id := range []string{"entry", "answer", "end"} {
		node, ok := res.Nodes[id].(map[string]any)
		require.True(t, ok, "missing node %q in result.nodes", id)
		assert.Equal(t, "success", node["status"])
	}
}

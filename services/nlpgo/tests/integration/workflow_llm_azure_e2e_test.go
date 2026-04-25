//go:build live_azure

package integration_test

// Azure OpenAI counterpart to the OpenAI / Anthropic / Gemini live e2es.
// Owner brief flagged Azure as one of the "tricky enterprise" providers
// the migration must keep working — Azure needs endpoint + api_version
// + deployment self-mapping (handled by withDeploymentMap in
// dispatcheradapter), plus the dispatcheradapter has to translate
// litellm_params{api_base → endpoint} so customers' existing workflow
// configs work bit-for-bit.
//
// Build tag: live_azure (gated; needs AZURE_OPENAI_ENDPOINT +
// AZURE_OPENAI_API_KEY in env).

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

func setupStackWithLLM_azure(t *testing.T) *stack {
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
	executor := liveAzureExecutorAdapter{eng: eng}
	application := app.New(app.WithWorkflowExecutor(executor))
	probes := health.New("test")
	probes.MarkStarted()
	router := httpapi.NewRouter(httpapi.RouterDeps{App: application, Health: probes, Version: "test"})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	t.Cleanup(upstream.Close)
	return &stack{url: srv.URL, upstream: upstream, upstreamURL: upstream.URL}
}

type liveAzureExecutorAdapter struct{ eng *engine.Engine }

func (a liveAzureExecutorAdapter) ExecuteStream(ctx context.Context, req app.WorkflowRequest, opts app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
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

func (a liveAzureExecutorAdapter) Execute(ctx context.Context, req app.WorkflowRequest) (*app.WorkflowResult, error) {
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

// TestSync_RealWorkflowEndToEnd_Azure exercises the Azure-OpenAI inline-
// credentials path: api_base + api_key → withDeploymentMap self-deployment
// → BifrostRouter Azure dispatch. Owner-flagged enterprise provider.
func TestSync_RealWorkflowEndToEnd_Azure(t *testing.T) {
	apiKey := os.Getenv("AZURE_OPENAI_API_KEY")
	endpoint := os.Getenv("AZURE_OPENAI_ENDPOINT")
	if apiKey == "" || endpoint == "" {
		t.Skip("AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT must be set")
	}
	model := os.Getenv("AZURE_MODEL")
	if model == "" {
		model = "gpt-5-mini"
	}
	stack := setupStackWithLLM_azure(t)

	body := `{
	  "type": "execute_flow",
	  "payload": {
	    "trace_id": "real-e2e-azure",
	    "origin": "workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"AzureMath","icon":"🧮","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"question","type":"str"}],
	          "dataset":{"inline":{"records":{"question":["What is 6+6? Reply with just the digits."]}}},
	          "entry_selection":0,
	          "train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"answer","type":"signature","data":{
	          "name":"Answer",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{
	              "model":"azure/` + model + `",
	              "litellm_params":{"api_key":"` + apiKey + `","api_base":"` + endpoint + `"}
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
	assert.Equal(t, "real-e2e-azure", res.TraceID)

	answer, _ := res.Result["answer"].(string)
	require.NotEmpty(t, answer, "expected non-empty answer from real Azure call")
	assert.True(t, strings.ContainsAny(answer, "0123456789"),
		"expected a digit in the answer, got %q", answer)

	require.NotNil(t, res.Nodes)
	for _, id := range []string{"entry", "answer", "end"} {
		node, ok := res.Nodes[id].(map[string]any)
		require.True(t, ok, "missing node %q in result.nodes", id)
		assert.Equal(t, "success", node["status"])
	}
}

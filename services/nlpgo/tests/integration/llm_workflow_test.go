package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/gatewayclient"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/llmexecutor"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// llmStack assembles nlpgo with a fake AI Gateway in front. The stub
// gateway records the inbound request shape and returns a canned
// chat-completion response so the engine has a real LLMClient to
// exercise — no provider calls, no API keys.
type llmStack struct {
	url     string
	gateway *httptest.Server
	captured []capturedCall
}

type capturedCall struct {
	Path        string
	Method      string
	BodyJSON    map[string]any
	HasInternal bool
	HasInline   bool
	OriginHdr   string
}

func setupLLMStack(t *testing.T, response map[string]any) *llmStack {
	t.Helper()
	s := &llmStack{}

	s.gateway = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var parsed map[string]any
		_ = json.Unmarshal(body, &parsed)
		s.captured = append(s.captured, capturedCall{
			Path:        r.URL.Path,
			Method:      r.Method,
			BodyJSON:    parsed,
			HasInternal: r.Header.Get("X-LangWatch-Internal-Auth") != "",
			HasInline:   r.Header.Get("X-LangWatch-Inline-Credentials") != "",
			OriginHdr:   r.Header.Get("X-LangWatch-Origin"),
		})
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}))
	t.Cleanup(s.gateway.Close)

	gw, err := gatewayclient.New(gatewayclient.Options{
		BaseURL:        s.gateway.URL,
		InternalSecret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	})
	require.NoError(t, err)
	llm := llmexecutor.New(gw)

	httpExec := httpblock.New(httpblock.Options{})
	codeExec, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)

	eng := engine.New(engine.Options{HTTP: httpExec, Code: codeExec, LLM: llm})
	executor := llmExecutorAdapter{eng: eng}
	application := app.New(app.WithWorkflowExecutor(executor))

	probes := health.New("test")
	probes.MarkStarted()

	router := httpapi.NewRouter(httpapi.RouterDeps{
		App:     application,
		Health:  probes,
		Version: "test",
	})

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	s.url = srv.URL
	return s
}

type llmExecutorAdapter struct {
	eng *engine.Engine
}

func (a llmExecutorAdapter) Execute(ctx context.Context, req app.WorkflowRequest) (*app.WorkflowResult, error) {
	wf, err := dsl.ParseWorkflow(req.WorkflowJSON)
	if err != nil {
		return &app.WorkflowResult{
			Status: "error",
			Error:  &app.WorkflowError{Type: "invalid_workflow", Message: err.Error()},
		}, nil
	}
	res, err := a.eng.Execute(ctx, engine.ExecuteRequest{
		Workflow: wf,
		Inputs:   req.Inputs,
		Origin:   req.Origin,
	})
	if err != nil {
		return &app.WorkflowResult{
			Status: "error",
			Error:  &app.WorkflowError{Type: "engine_error", Message: err.Error()},
		}, nil
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

// TestSync_SignatureNodeEndToEndAgainstStubGateway proves the full
// chain Engine → llmexecutor → gatewayclient → fake gateway works for
// a single Signature node, and that the gateway received an HMAC-
// signed request with the inline-creds header.
func TestSync_SignatureNodeEndToEndAgainstStubGateway(t *testing.T) {
	stack := setupLLMStack(t, map[string]any{
		"id":      "chatcmpl-fake",
		"object":  "chat.completion",
		"created": 1700000000,
		"model":   "gpt-5-mini",
		"choices": []any{
			map[string]any{
				"index":         0,
				"finish_reason": "stop",
				"message": map[string]any{
					"role":    "assistant",
					"content": "the answer is 42",
				},
			},
		},
		"usage": map[string]any{
			"prompt_tokens":     12,
			"completion_tokens": 5,
			"total_tokens":      17,
		},
	})

	body := `{
	  "trace_id": "test-trace-llm",
	  "origin": "workflow",
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{
	        "outputs":[{"identifier":"question","type":"str"}],
	        "dataset":{"inline":{"records":{"question":["what is the answer?"]}}},
	        "entry_selection":0,
	        "train_size":1.0,"test_size":0.0,"seed":1
	      }},
	      {"id":"sig","type":"signature","data":{
	        "name":"Answer",
	        "parameters":[
	          {"identifier":"llm","type":"llm","value":{
	            "model":"openai/gpt-5-mini",
	            "temperature":0.0,
	            "litellm_params":{"api_key":"sk-fake"}
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
	      {"id":"e1","source":"entry","sourceHandle":"outputs.question","target":"sig","targetHandle":"inputs.question","type":"default"},
	      {"id":"e2","source":"sig","sourceHandle":"outputs.answer","target":"end","targetHandle":"inputs.answer","type":"default"}
	    ],
	    "state":{}
	  }
	}`

	res := postSyncURL(t, stack.url, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.Equal(t, "the answer is 42", res.Result["answer"])

	// Gateway received a signed request to /v1/chat/completions.
	require.Len(t, stack.captured, 1)
	got := stack.captured[0]
	assert.Equal(t, "/v1/chat/completions", got.Path)
	assert.Equal(t, "POST", got.Method)
	assert.True(t, got.HasInternal, "X-LangWatch-Internal-Auth must be present")
	assert.True(t, got.HasInline, "X-LangWatch-Inline-Credentials must be present")

	// Body carried the customer's question, not the engine's plumbing.
	messages, ok := got.BodyJSON["messages"].([]any)
	require.True(t, ok, "body.messages should be a list")
	require.NotEmpty(t, messages)
	last, _ := messages[len(messages)-1].(map[string]any)
	assert.Equal(t, "user", last["role"])
	assert.Contains(t, last["content"], "what is the answer?")
}

// postSyncURL is the URL-only variant of postSync used by tests that
// build their own stack (instead of the shared dataset/HTTP/code one).
func postSyncURL(t *testing.T, url, body string) *app.WorkflowResult {
	t.Helper()
	req, err := http.NewRequest("POST", url+"/go/studio/execute_sync", bytes.NewBufferString(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-LangWatch-Origin", "workflow")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	require.Equal(t, http.StatusOK, resp.StatusCode, "body: %s", string(respBody))
	var out app.WorkflowResult
	require.NoError(t, json.Unmarshal(respBody, &out))
	return &out
}

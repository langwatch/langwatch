// Package integration tests the nlpgo service end-to-end through its
// HTTP server with no engine mocks. Each test stands up a real chi
// router, fronts it with httptest, and posts a workflow JSON to
// /go/studio/execute_sync — exercising parser, planner, block
// executors, and the response serializer in one go.
package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// stack assembles a fully-wired httpapi.Router around the engine,
// plus an upstream test server so HTTP-block workflows have somewhere
// to call. Returns the live test URL and an upstream URL for fixtures.
type stack struct {
	url         string
	upstream    *httptest.Server
	upstreamURL string
}

func (s *stack) close() {
	s.upstream.Close()
}

func setupStack(t *testing.T) *stack {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var got map[string]any
		_ = json.Unmarshal(body, &got)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"echo":   got,
			"status": "ok",
		})
	}))
	host, _, _ := net.SplitHostPort(upstream.Listener.Addr().String())

	httpExec := httpblock.New(httpblock.Options{
		SSRF: httpblock.SSRFOptions{AllowedHosts: []string{host}},
	})
	codeExec, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)

	eng := engine.New(engine.Options{HTTP: httpExec, Code: codeExec})

	executor := executorAdapter{eng: eng}
	application := app.New(app.WithWorkflowExecutor(executor))

	probes := health.New("test")
	probes.MarkStarted()

	router := httpapi.NewRouter(httpapi.RouterDeps{
		App:     application,
		Health:  probes,
		Version: "test",
		// InternalSecret left empty → HMAC middleware is in
		// "auth disabled" dev mode; perfect for tests.
	})

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	return &stack{url: srv.URL, upstream: upstream, upstreamURL: upstream.URL}
}

// executorAdapter is a copy of cmd.engineAdapter — kept inline so the
// integration test doesn't depend on the cmd package (avoids forcing
// the test binary to also pull in os.Args parsing).
type executorAdapter struct {
	eng *engine.Engine
}

func (a executorAdapter) ExecuteStream(ctx context.Context, req app.WorkflowRequest, opts app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
	wf, err := dsl.ParseWorkflow(req.WorkflowJSON)
	if err != nil {
		ch := make(chan app.WorkflowStreamEvent, 1)
		ch <- app.WorkflowStreamEvent{Type: "error", Payload: map[string]any{"message": err.Error()}}
		close(ch)
		return ch, nil
	}
	in, err := a.eng.ExecuteStream(ctx, engine.ExecuteRequest{
		Workflow: wf, Inputs: req.Inputs, Origin: req.Origin, TraceID: req.TraceID, ThreadID: req.ThreadID,
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

func (a executorAdapter) Execute(ctx context.Context, req app.WorkflowRequest) (*app.WorkflowResult, error) {
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
		TraceID:  req.TraceID,
		ThreadID: req.ThreadID,
	})
	if err != nil {
		return &app.WorkflowResult{
			Status: "error",
			Error:  &app.WorkflowError{Type: "engine_error", Message: err.Error()},
		}, nil
	}
	out := &app.WorkflowResult{
		TraceID: res.TraceID,
		Status:  res.Status,
		Result:  res.Result,
	}
	if res.Error != nil {
		out.Error = &app.WorkflowError{
			NodeID:  res.Error.NodeID,
			Type:    res.Error.Type,
			Message: res.Error.Message,
		}
	}
	if len(res.Nodes) > 0 {
		out.Nodes = make(map[string]any, len(res.Nodes))
		for k, v := range res.Nodes {
			out.Nodes[k] = v
		}
	}
	return out, nil
}

func postSync(t *testing.T, stack *stack, body string) *app.WorkflowResult {
	t.Helper()
	req, err := http.NewRequest("POST", stack.url+"/go/studio/execute_sync", bytes.NewBufferString(body))
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

// TestSync_DatasetEntrySelectionThroughHTTPServer exercises the very
// thinnest happy path: an entry node with one row, an end node that
// echoes it back. No external upstreams; just engine wiring.
func TestSync_DatasetEntrySelectionThroughHTTPServer(t *testing.T) {
	stack := setupStack(t)
	defer stack.close()

	body := `{
	  "trace_id": "test-trace-1",
	  "origin": "workflow",
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{
	        "outputs":[{"identifier":"q","type":"str"}],
	        "dataset":{"inline":{"records":{"q":["hello world"]}}},
	        "entry_selection":0,
	        "train_size":1.0,"test_size":0.0,"seed":1
	      }},
	      {"id":"end","type":"end","data":{
	        "inputs":[{"identifier":"q","type":"str"}]
	      }}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"outputs.q","target":"end","targetHandle":"inputs.q","type":"default"}
	    ],
	    "state":{}
	  }
	}`

	res := postSync(t, stack, body)
	assert.Equal(t, "success", res.Status)
	assert.Equal(t, "hello world", res.Result["q"])
	assert.Equal(t, "test-trace-1", res.TraceID)
}

// TestSync_HTTPBlockEndToEnd shows the engine driving an HTTP block
// against a real upstream test server — the same shape a customer's
// "GET data from external API and pass to next node" workflow uses.
func TestSync_HTTPBlockEndToEnd(t *testing.T) {
	stack := setupStack(t)
	defer stack.close()

	body := `{
	  "trace_id": "test-trace-http",
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{
	        "outputs":[{"identifier":"q","type":"str"}],
	        "dataset":{"inline":{"records":{"q":["ping"]}}},
	        "entry_selection":0,
	        "train_size":1.0,"test_size":0.0,"seed":1
	      }},
	      {"id":"call","type":"http","data":{
	        "parameters":[
	          {"identifier":"url","type":"str","value":"` + stack.upstreamURL + `/echo"},
	          {"identifier":"method","type":"str","value":"POST"},
	          {"identifier":"body_template","type":"str","value":"{\"q\":\"{{ q }}\"}"},
	          {"identifier":"output_path","type":"str","value":"$.echo.q"}
	        ],
	        "outputs":[{"identifier":"answer","type":"str"}]
	      }},
	      {"id":"end","type":"end","data":{
	        "inputs":[{"identifier":"answer","type":"str"}]
	      }}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"outputs.q","target":"call","targetHandle":"inputs.q","type":"default"},
	      {"id":"e2","source":"call","sourceHandle":"outputs.answer","target":"end","targetHandle":"inputs.answer","type":"default"}
	    ],
	    "state":{}
	  }
	}`

	res := postSync(t, stack, body)
	assert.Equal(t, "success", res.Status)
	assert.Equal(t, "ping", res.Result["answer"])
}

// TestSync_CodeBlockEndToEnd runs a Python code-block subprocess
// through the full HTTP path. Skips when python3 isn't installed
// (the runtime requirement is documented in code-block.feature).
func TestSync_CodeBlockEndToEnd(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not installed")
	}
	stack := setupStack(t)
	defer stack.close()

	body := `{
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{
	        "outputs":[{"identifier":"a","type":"int"},{"identifier":"b","type":"int"}],
	        "dataset":{"inline":{"records":{"a":[2],"b":[3]}}},
	        "entry_selection":0,
	        "train_size":1.0,"test_size":0.0,"seed":1
	      }},
	      {"id":"sum","type":"code","data":{
	        "parameters":[
	          {"identifier":"code","type":"code","value":"def execute(a, b):\n    return {'sum': a + b}\n"}
	        ],
	        "inputs":[{"identifier":"a","type":"int"},{"identifier":"b","type":"int"}],
	        "outputs":[{"identifier":"sum","type":"int"}]
	      }},
	      {"id":"end","type":"end","data":{
	        "inputs":[{"identifier":"sum","type":"int"}]
	      }}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"outputs.a","target":"sum","targetHandle":"inputs.a","type":"default"},
	      {"id":"e2","source":"entry","sourceHandle":"outputs.b","target":"sum","targetHandle":"inputs.b","type":"default"},
	      {"id":"e3","source":"sum","sourceHandle":"outputs.sum","target":"end","targetHandle":"inputs.sum","type":"default"}
	    ],
	    "state":{}
	  }
	}`
	res := postSync(t, stack, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.Equal(t, float64(5), res.Result["sum"])
}

// TestSync_RejectsUnsupportedNodeKind exercises the planner →
// executor → handler error path the TS feature flag relies on for
// fall-back. Uses a fictitious "future_kind" type so the test stays
// stable as we grow the supportedKinds set (agent + evaluator joined
// the set in iter-18 once the agentblock + evaluatorblock executors
// landed).
func TestSync_RejectsUnsupportedNodeKind(t *testing.T) {
	stack := setupStack(t)
	defer stack.close()

	body := `{
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{"train_size":1.0,"test_size":0.0,"seed":1}},
	      {"id":"f","type":"future_kind_reserved_for_test","data":{}}
	    ],
	    "edges":[{"id":"e1","source":"entry","sourceHandle":"x","target":"f","targetHandle":"x","type":"default"}],
	    "state":{}
	  }
	}`
	res := postSync(t, stack, body)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	// Planner.UnsupportedNodeKindError bubbles up via the engine_error
	// wrapper at the app boundary; the message still names the offending
	// kind so the TS feature flag can choose to fall back to Python.
	assert.Equal(t, "engine_error", res.Error.Type)
	assert.Contains(t, res.Error.Message, "future_kind")
}

// TestSync_RejectsRetiredKindRetriever exercises the new
// RetiredNodeKindError path — retired kinds get a different reason
// code so the Studio UI can surface a "remove the node" message
// instead of the unsupported-kind fall-back message.
func TestSync_RejectsRetiredKindRetriever(t *testing.T) {
	stack := setupStack(t)
	defer stack.close()

	body := `{
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{"train_size":1.0,"test_size":0.0,"seed":1}},
	      {"id":"r","type":"retriever","data":{}}
	    ],
	    "edges":[{"id":"e1","source":"entry","sourceHandle":"x","target":"r","targetHandle":"x","type":"default"}],
	    "state":{}
	  }
	}`
	res := postSync(t, stack, body)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Message, "retired")
}

// TestSync_LLMNodeReturnsExecutorUnavailableUntilWired covers the
// transition state — until @ash's LLM executor is wired, signature
// nodes must surface a clean error rather than panic.
func TestSync_LLMNodeReturnsExecutorUnavailableUntilWired(t *testing.T) {
	stack := setupStack(t)
	defer stack.close()

	body := `{
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{
	        "outputs":[{"identifier":"q","type":"str"}],
	        "dataset":{"inline":{"records":{"q":["hi"]}}},
	        "entry_selection":0,
	        "train_size":1.0,"test_size":0.0,"seed":1
	      }},
	      {"id":"sig","type":"signature","data":{
	        "parameters":[{"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini"}}],
	        "inputs":[{"identifier":"q","type":"str"}],
	        "outputs":[{"identifier":"a","type":"str"}]
	      }},
	      {"id":"end","type":"end","data":{"inputs":[{"identifier":"a","type":"str"}]}}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"outputs.q","target":"sig","targetHandle":"inputs.q","type":"default"},
	      {"id":"e2","source":"sig","sourceHandle":"outputs.a","target":"end","targetHandle":"inputs.a","type":"default"}
	    ],
	    "state":{}
	  }
	}`
	res := postSync(t, stack, body)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Equal(t, "llm_executor_unavailable", res.Error.Type)
}

// TestSync_EdgeHandleRenamesAcrossNodes verifies the engine honors
// Studio's outputs.X → inputs.Y renaming on edges. Customer workflows
// frequently use edges like sourceHandle="outputs.question",
// targetHandle="inputs.user_query"; without renaming the downstream
// node would never see its declared input.
func TestSync_EdgeHandleRenamesAcrossNodes(t *testing.T) {
	stack := setupStack(t)
	defer stack.close()

	body := `{
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{
	        "outputs":[{"identifier":"question","type":"str"}],
	        "dataset":{"inline":{"records":{"question":["hello"]}}},
	        "entry_selection":0,
	        "train_size":1.0,"test_size":0.0,"seed":1
	      }},
	      {"id":"end","type":"end","data":{
	        "inputs":[{"identifier":"user_query","type":"str"}]
	      }}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"outputs.question","target":"end","targetHandle":"inputs.user_query","type":"default"}
	    ],
	    "state":{}
	  }
	}`

	res := postSync(t, stack, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	// The edge renamed entry.outputs.question → end.inputs.user_query.
	// Result MUST surface under "user_query", not under "question".
	assert.Equal(t, "hello", res.Result["user_query"])
	_, hasOldName := res.Result["question"]
	assert.False(t, hasOldName, "renamed inputs must not leak the source name into the end-node output")
}

// TestHealthz exposes the /healthz endpoint to smoke-test the full
// chain (router + middlewares + health registry). No engine activity.
func TestHealthz(t *testing.T) {
	stack := setupStack(t)
	defer stack.close()
	resp, err := http.Get(stack.url + "/healthz")
	require.NoError(t, err)
	defer resp.Body.Close()
	// Health may be 200 or 503 depending on whether registered probes
	// pass; we only care it's wired and returns JSON.
	assert.Contains(t, []int{http.StatusOK, http.StatusServiceUnavailable}, resp.StatusCode)
	assert.Contains(t, resp.Header.Get("Content-Type"), "json")
}

package targets

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/scenariorunner/egress"
	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

func openHTTP() HTTPDoer {
	return egress.NewClient(egress.ClientOptions{Validator: egress.NewValidator(egress.Policy{}, nil)})
}

func userTurn(thread, text string) Turn {
	m := []Message{{Role: "user", Content: text}}
	return Turn{ThreadID: thread, Messages: m, NewMessages: m}
}

func ptr[T any](v T) *T { return &v }

func TestHTTPAgentSendsTheDefaultBodyAndHoldsTheSession(t *testing.T) {
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(raw))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"ok","state":{"step":2}}`))
	}))
	defer srv.Close()
	agent := NewHTTPAgent(HTTPAgentOptions{
		Config: HTTPAgentData{URL: srv.URL + "/?s={{ session.step }}", Method: "post", OutputPath: ptr("$.text"), SessionPath: ptr("$.state")},
		HTTP:   openHTTP(),
	})

	first, err := agent.Call(context.Background(), userTurn("t1", "hi"))
	require.NoError(t, err)
	assert.Equal(t, "ok", first)
	wantBody := `{"messages":[{"role":"user","content":"hi"}]}`
	assert.Equal(t, wantBody, bodies[0], "the default body is JSON.stringify({ messages })")
	held, _ := agent.sessions.of("t1")
	assert.Equal(t, `{"step":2}`, jsjson.Stringify(held))
}

func TestHTTPAgentRefusesAURLWhoseHostTheSessionChose(t *testing.T) {
	agent := NewHTTPAgent(HTTPAgentOptions{Config: HTTPAgentData{URL: "https://{{ session }}/x", Method: "POST"}, HTTP: openHTTP()})
	require.NoError(t, agent.sessions.store("t", "evil.example"))

	_, err := agent.Call(context.Background(), userTurn("t", "hi"))
	require.ErrorContains(t, err, "the session of the agent cannot decide the host the turn is sent to")
}

func TestHTTPAgentReportsAnErrorResponseWithSecretsScrubbed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("x-request-id", "req-9")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("bad token tok-abcdef123"))
	}))
	defer srv.Close()
	agent := NewHTTPAgent(HTTPAgentOptions{
		Config: HTTPAgentData{URL: srv.URL + "/chat?key={{ secrets.TOKEN }}", Method: "POST", Secrets: map[string]string{"TOKEN": "tok-abcdef123"}},
		HTTP:   openHTTP(),
	})

	_, err := agent.Call(context.Background(), userTurn("t", "hi"))
	require.Error(t, err)
	assert.Equal(t, "HTTP 401: Unauthorized from "+srv.URL+"/chat (request-id: req-9): bad token [redacted]", err.Error())
}

func TestHeaderTemplateRefusesALineBreak(t *testing.T) {
	agent := NewHTTPAgent(HTTPAgentOptions{
		Config: HTTPAgentData{URL: "http://agent.example/", Method: "POST", Headers: []HeaderEntry{{Key: "X-In", Value: "{{ input }}"}}},
		HTTP:   openHTTP(),
	})
	_, err := agent.Call(context.Background(), userTurn("t", "a\r\nInjected: yes"))
	require.ErrorContains(t, err, `Failed to render headers template (header "X-In")`)
}

// engineServer answers execute_sync with body and records the event it got.
func engineServer(t *testing.T, status int, body string, got *string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		*got = string(raw)
		assert.Equal(t, "/go/studio/execute_sync", r.URL.Path)
		assert.Equal(t, "engine-secret", r.Header.Get(NLPInternalSecretHeader))
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
}

func codeAgentFor(url string) *CodeAgent {
	return NewCodeAgent(CodeAgentData{AgentID: "ag", Code: "def run(input): return input",
		Inputs: []IO{{Identifier: "question", Type: "str"}}, Outputs: []IO{{Identifier: "answer", Type: "str"}}},
		EngineAgentOptions{ProjectAPIKey: "sk-lw-project-key", Parameters: jsjson.NewObject().Set("tier", "gold"),
			Transport: TransportInput{NLPServiceURL: url, NLPInternalSecret: "engine-secret"}})
}

func TestCodeAgentRunsASynthesizedWorkflowAndKeepsTheSession(t *testing.T) {
	var event string
	srv := engineServer(t, 200, `{"status":"success","result":{"answer":"42"},"nodes":{"code_agent":{"outputs":{"answer":"42","session":{"n":1}}}}}`, &event)
	defer srv.Close()
	agent := codeAgentFor(srv.URL + "/")

	reply, err := agent.Call(context.Background(), userTurn("t", "what is it"))
	require.NoError(t, err)
	assert.Equal(t, "42", reply)
	assert.Contains(t, event, `"type":"execute_flow"`)
	assert.Contains(t, event, `"workflow_id":"scenario-code-ag"`)
	assert.Contains(t, event, `"inputs":[{"question":"what is it"}]`)
	assert.Contains(t, event, `"params":{"tier":"gold"}`)
	held, _ := agent.sessions.of("t")
	assert.Equal(t, `{"n":1}`, jsjson.Stringify(held))
}

func TestCodeAgentWordsAUserCodeFailureForTheCustomer(t *testing.T) {
	var event string
	srv := engineServer(t, 200, `{"status":"error","error":{"type":"ValueError","traceback":"Traceback\n  ValueError: boom sk-lw-project-key"}}`, &event)
	defer srv.Close()

	_, err := codeAgentFor(srv.URL).Call(context.Background(), userTurn("t", "x"))
	require.Error(t, err)
	assert.Equal(t, strings.Join([]string{
		"SerializedCodeAgentAdapter: user code raised an error during execution.",
		"  type: ValueError",
		"  user code error:",
		"    Traceback",
		"      ValueError: boom [redacted]",
	}, "\n"), err.Error())
}

func TestCodeAgentHidesTheEngineAddressOnAServiceFailure(t *testing.T) {
	var event string
	srv := engineServer(t, 502, `{"error":{"type":"engine_error","message":"upstream http://10.0.0.7:5561/x failed"}}`, &event)
	defer srv.Close()

	_, err := codeAgentFor(srv.URL).Call(context.Background(), userTurn("t", "x"))
	require.Error(t, err)
	assert.Equal(t, "SerializedCodeAgentAdapter: NLP service returned HTTP 502.\n  body:\n    upstream [redacted] failed", err.Error())
}

func TestWorkflowAgentNamesAMissingOutputField(t *testing.T) {
	var event string
	srv := engineServer(t, 200, `{"status":"success","result":{"other":"x"}}`, &event)
	defer srv.Close()
	agent := NewWorkflowAgent(WorkflowAgentData{Workflow: jsjson.NewObject().Set("name", "wf"), ScenarioOutputField: ptr("answer")},
		EngineAgentOptions{ProjectAPIKey: "k", Transport: TransportInput{NLPServiceURL: srv.URL, NLPInternalSecret: "engine-secret"}})

	_, err := agent.Call(context.Background(), userTurn("t", "x"))
	require.EqualError(t, err, `Scenario output field "answer" not found in agent output. Available fields: other`)
	assert.Contains(t, event, `"api_key":"k"`)
	assert.Contains(t, event, `"inputs":[{"input":"x"}]`)
}

func TestConnectedAgentRetriesABusyAgentThenRecordsTheInstance(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		assert.Equal(t, "/api/v1/agents/ag/call", r.URL.Path)
		assert.Equal(t, "sk-key", r.Header.Get("X-Auth-Token"))
		if calls == 1 {
			w.Header().Set("Retry-After", "0.01")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write([]byte(`{"output":"done","session":"s1","instance":{"hostname":"box","label":null}}`))
	}))
	defer srv.Close()
	agent := NewConnectedAgent(ConnectedAgentData{AgentID: "ag", Endpoint: srv.URL + "/", TimeoutMs: 1000}, ConnectedAgentOptions{ProjectAPIKey: "sk-key"})
	agent.sleep = func(context.Context, time.Duration) {}

	reply, err := agent.Call(context.Background(), userTurn("t", "go"))
	require.NoError(t, err)
	assert.Equal(t, "done", reply)
	assert.Equal(t, 2, calls)
	assert.Equal(t, &Instance{Hostname: "box"}, agent.ServedInstance())
}

func TestConnectedAgentNamesTheRelaysCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"code":"agent_offline","message":"No instance is connected."}`))
	}))
	defer srv.Close()
	agent := NewConnectedAgent(ConnectedAgentData{AgentID: "ag", Endpoint: srv.URL, TimeoutMs: 1000}, ConnectedAgentOptions{ProjectAPIKey: "k"})

	_, err := agent.Call(context.Background(), userTurn("t", "go"))
	require.EqualError(t, err, "Connected agent call failed (agent_offline): No instance is connected.")
}

func TestSessionAboveTheCapIsRefused(t *testing.T) {
	var s sessions
	err := s.store("t", strings.Repeat("x", SessionMaxBytes))
	require.ErrorContains(t, err, "Agent session too large (agent_payload_too_large)")
}

func TestPromptTemplateReadsTheConversationOnlyInAnExpression(t *testing.T) {
	assert.True(t, referencesConversation("History: {{ messages }}"))
	assert.True(t, referencesConversation("{% for m in messagesJson %}{% endfor %}"))
	assert.False(t, referencesConversation("Read the messages carefully"))
	assert.False(t, referencesConversation(`{{ "messages" }}`))
}

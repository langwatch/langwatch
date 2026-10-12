package scenariorunner

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	coltrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

// runJobText runs one job through the runner the way the worker does and
// returns the exit code and the last stdout line, which is what parseResult reads.
func runJobText(t *testing.T, env Env, job string) (int, map[string]any, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := Run(context.Background(), env, IO{Stdin: strings.NewReader(job), Stdout: &stdout, Stderr: &stderr})
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	last := lines[len(lines)-1]
	var parsed map[string]any
	require.NoError(t, json.Unmarshal([]byte(last), &parsed), "the last stdout line is JSON: %q (stderr %s)", last, stderr.String())
	return code, parsed, last
}

func baseEnv(policy string) Env {
	return Env{
		LangWatchEndpoint:  "http://langwatch.invalid",
		LangWatchAPIKey:    "sk-lw-run-key",
		EgressPolicy:       policy,
		RejectUnauthorized: true,
	}
}

const openPolicy = `{"blockLocal":false,"allowedHosts":[]}`

func agentTestJob(url string) string {
	return `{"kind":"agent-test-turn","adapterData":{"type":"http","agentId":"agent_1","url":"` + url + `","method":"POST",
		"headers":[{"key":"Authorization","value":"Bearer {{ secrets.TOKEN }}"}],
		"bodyTemplate":"{\"q\": \"{{ input }}\", \"tier\": \"{{ params.tier }}\"}",
		"outputPath":"$.reply.text","secrets":{"TOKEN":"tok-123456789"}},
		"executeSyncRoute":{"mode":"direct","nlpServiceUrl":"http://nlp"},"parameters":{"tier":"gold"},
		"message":"hi \"there\"","timeoutMs":5000,"nlpTimeouts":{}}`
}

// @scenario "An agent-test turn answers through the HTTP target"
func TestAgentTestTurnAnswersThroughTheFencedHTTPTarget(t *testing.T) {
	var gotBody, gotAuth, gotTraceparent string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		gotBody, gotAuth, gotTraceparent = string(raw), r.Header.Get("Authorization"), r.Header.Get("traceparent")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"reply":{"text":"hello back"}}`))
	}))
	defer srv.Close()

	code, answer, _ := runJobText(t, baseEnv(openPolicy), agentTestJob(srv.URL+"/chat"))

	assert.Equal(t, 0, code)
	assert.Equal(t, true, answer["success"])
	assert.Equal(t, "hello back", answer["output"])
	assert.Contains(t, answer, "durationMs")
	wantBody := `{"q": "hi \"there\"", "tier": "gold"}`
	assert.Equal(t, wantBody, gotBody, "the body template escapes values for a JSON string, byte for byte")
	assert.Equal(t, "Bearer tok-123456789", gotAuth, "secret references resolve in headers")
	assert.Empty(t, gotTraceparent, "an agent test turn runs outside a traced simulation")
}

// @scenario "An HTTP target behind the fence is refused before any connection is made"
func TestAgentTestTurnIsRefusedByTheFence(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()

	code, answer, _ := runJobText(t, baseEnv(`{"blockLocal":true,"allowedHosts":[]}`), agentTestJob(srv.URL+"/chat"))

	assert.Equal(t, 1, code)
	assert.Equal(t, false, answer["success"])
	assert.Contains(t, answer["error"], "could not be reached: Access to private or localhost IP addresses is not allowed for security reasons")
}

// @scenario "A run without its egress policy or telemetry destination refuses by name"
// @scenario "A voice target is refused by name"
func TestRunRefusals(t *testing.T) {
	cases := []struct {
		name string
		env  Env
		job  string
		want string
	}{
		{"no egress policy", baseEnv(""), agentTestJob("http://agent.example/"), "LANGWATCH_SCENARIO_EGRESS_POLICY is not set"},
		{"no telemetry destination", Env{EgressPolicy: openPolicy}, agentTestJob("http://agent.example/"),
			"LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env"},
		{"a job that does not parse", baseEnv(openPolicy), `{"kind":`, "Failed to parse job data: "},
		{"a voice target", baseEnv(openPolicy), `{"kind":"agent-test-turn","adapterData":{"type":"voice","agentId":"v",
			"voiceTarget":{"transport":"phone","agentId":"v","credential":null}},"executeSyncRoute":{"mode":"direct","nlpServiceUrl":"x"},
			"message":"m","timeoutMs":5,"nlpTimeouts":{}}`, "Voice targets are not supported by the Go scenario runner yet"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, answer, _ := runJobText(t, tc.env, tc.job)
			assert.Equal(t, 1, code)
			assert.Equal(t, false, answer["success"])
			assert.Contains(t, answer["error"], tc.want)
		})
	}
}

// fakePlatform plays the engine's LLM proxy and the LangWatch API: the
// simulator says hello, the judge passes every criterion.
type fakePlatform struct {
	mu         sync.Mutex
	paths      []string
	models     []string
	secrets    []string
	agentCalls int
	resource   map[string]string
}

func (f *fakePlatform) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	f.paths = append(f.paths, r.URL.Path)
	f.mu.Unlock()
	switch r.URL.Path {
	case "/go/proxy/v1/chat/completions":
		f.mu.Lock()
		f.models = append(f.models, r.Header.Get("x-litellm-model"))
		f.secrets = append(f.secrets, r.Header.Get("X-LangWatch-NLP-Secret"))
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(completionFor(raw)))
	case "/api/otel/v1/traces":
		f.recordResource(r, raw)
	case "/agent":
		f.mu.Lock()
		f.agentCalls++
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"answer":"hello, how can I help?"}`))
	default:
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}
}

// recordResource keeps the resource attributes of exported spans.
func (f *fakePlatform) recordResource(r *http.Request, raw []byte) {
	if r.Header.Get("Content-Encoding") == "gzip" {
		zr, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			return
		}
		raw, _ = io.ReadAll(zr)
	}
	var req coltrace.ExportTraceServiceRequest
	if proto.Unmarshal(raw, &req) != nil {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, rs := range req.GetResourceSpans() {
		for _, kv := range rs.GetResource().GetAttributes() {
			if f.resource == nil {
				f.resource = map[string]string{}
			}
			f.resource[kv.GetKey()] = kv.GetValue().GetStringValue()
		}
	}
}

func completionFor(raw []byte) string {
	var req struct {
		Tools []struct {
			Function struct {
				Name string `json:"name"`
			} `json:"function"`
		} `json:"tools"`
	}
	_ = json.Unmarshal(raw, &req)
	names := map[string]bool{}
	for _, tool := range req.Tools {
		names[tool.Function.Name] = true
	}
	call := func(name, args string) string {
		b, _ := json.Marshal(args)
		return `{"choices":[{"message":{"content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"` +
			name + `","arguments":` + string(b) + `}}]}}]}`
	}
	switch {
	case names["finish_test"]:
		return call("finish_test", `{"criteria":{"says_hello":{"requirement":"says hello","reasoning":"it did","status":"passed"}},"reasoning":"The agent greeted the user"}`)
	case names["make_verdict"]:
		return call("make_verdict", `{}`)
	}
	return `{"choices":[{"message":{"content":"hi"}}]}`
}

// @scenario "A simulation runs on the Go SDK and ends with the verdict line"
func TestSimulationRunsOnTheGoSDKAndReportsTheVerdict(t *testing.T) {
	t.Setenv("SCENARIO_HEADLESS", "true")
	t.Setenv("SCENARIO_DISABLE_SIMULATION_REPORT_INFO", "1")
	platform := &fakePlatform{}
	srv := httptest.NewServer(platform)
	defer srv.Close()
	env := baseEnv(openPolicy)
	env.LangWatchEndpoint = srv.URL
	env.NLPInternalSecret = "engine-secret"
	env.ResourceAttributes = "langwatch.origin.source=platform,scenario.labels=smoke"
	job := `{"context":{"projectId":"p","scenarioId":"scen_1","setId":"set_1","batchRunId":"batch_1"},
		"scenario":{"id":"scen_1","name":"Greets","situation":"A user says hi","criteria":["says hello"],"labels":["smoke"],"maxTurns":1},
		"scenarioRunId":"scenariorun_1",
		"adapterData":{"type":"http","agentId":"a","url":"` + srv.URL + `/agent","method":"POST","headers":[],"outputPath":"$.answer"},
		"simulatorModelParams":{"model":"openai/sim"},"judgeModelParams":{"model":"openai/judge"},
		"nlpServiceUrl":"` + srv.URL + `","target":{"type":"http","referenceId":"a"}}`

	code, result, line := runJobText(t, env, job)

	assert.Equal(t, 0, code, line)
	wantLine := `{"success":true,"reasoning":"The agent greeted the user"}`
	assert.Equal(t, wantLine, line, "the result line is byte-equal to the Node child's")
	assert.Equal(t, true, result["success"])
	assert.Equal(t, 1, platform.agentCalls)
	assert.Contains(t, platform.models, "openai/sim")
	assert.Contains(t, platform.models, "openai/judge")
	assert.NotContains(t, platform.secrets, "", "every engine call carries the internal secret")
	assert.Contains(t, platform.paths, "/api/scenario-events", "run events reach LangWatch")
	assert.Equal(t, "platform", platform.resource["langwatch.origin.source"], "spans are flushed with the parent's resource")
	assert.Equal(t, "smoke", platform.resource["scenario.labels"])
}

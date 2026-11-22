package workerrun

import (
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func ingestRun(t *testing.T, appURL string, families ...string) *run {
	t.Helper()
	chosen := map[string]bool{}
	for _, family := range families {
		chosen[family] = true
	}
	return &run{options: Options{N: 2, Seed: 1, Concurrency: 2}, tag: "wrtest", began: time.Unix(1_700_000_000, 0),
		appURL: appURL, client: http.DefaultClient, key: "sk-test", projectID: "project_test", families: chosen,
		fired502: map[string]int{}, setupFailed: map[string]string{}, skipped: map[string]string{}}
}

func fastRetry(t *testing.T) {
	t.Helper()
	previous := retryPause
	retryPause = time.Millisecond
	t.Cleanup(func() { retryPause = previous })
}

// prove fires the item and runs its check once.
func prove(t *testing.T, it *item) (bool, string) {
	t.Helper()
	if err := it.fire(t.Context()); err != nil {
		t.Fatalf("%s fire: %v", it.id, err)
	}
	return it.check(t.Context(), &round{})
}

// fakeStack accepts every send and answers every trace with answer and every session with one event.
type fakeStack struct {
	mu     sync.Mutex
	answer string
	sends  []string
	reads  []string
}

func (s *fakeStack) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	_, _ = io.Copy(io.Discard, r.Body)
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case r.Method == http.MethodPost:
		s.sends = append(s.sends, r.Header.Get("Content-Type")+"|"+r.Header.Get("Content-Encoding"))
		_, _ = io.WriteString(w, "{}")
	case strings.HasPrefix(r.URL.Path, "/api/traces/"):
		s.reads = append(s.reads, strings.TrimPrefix(r.URL.Path, "/api/traces/"))
		_, _ = io.WriteString(w, s.answer)
	default:
		s.reads = append(s.reads, r.URL.Path)
		_, _ = io.WriteString(w, `{"events":[{"kind":"model_call"}]}`)
	}
}

// @scenario "a door that cannot hand a batch off answers 503, which is retried"
func TestSendRawRetriesA503(t *testing.T) {
	fastRetry(t)
	var calls atomic.Int32
	door := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = io.WriteString(w, "{}")
	}))
	defer door.Close()
	err := ingestRun(t, door.URL).sendRaw(t.Context(), rawCall{family: "otlp-json", path: tracesPath, payload: jsonPayload([]byte("{}"))})
	if err != nil || calls.Load() != 2 {
		t.Fatalf("sendRaw = %v after %d calls, want nil after 2", err, calls.Load())
	}
}

// @scenario "a door that keeps answering 503 fails the item by its id"
func TestSendRawGivesUpAfterThreeTries(t *testing.T) {
	fastRetry(t)
	var calls atomic.Int32
	door := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer door.Close()
	err := ingestRun(t, door.URL).sendRaw(t.Context(), rawCall{family: "otlp-json", path: tracesPath, payload: jsonPayload([]byte("{}"))})
	if err == nil || !strings.Contains(err.Error(), "status 503") || calls.Load() != ingestAttempts {
		t.Fatalf("sendRaw = %v after %d calls", err, calls.Load())
	}
}

// @scenario "a 2xx answer that rejects part of the batch fails the item"
func TestSendRawFailsOnAPartialRejection(t *testing.T) {
	door := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"partialSuccess":{"rejectedSpans":"2","errorMessage":"bad span"}}`)
	}))
	defer door.Close()
	err := ingestRun(t, door.URL).sendRaw(t.Context(), rawCall{family: "otlp-json", path: tracesPath, payload: jsonPayload([]byte("{}"))})
	if err == nil || !strings.Contains(err.Error(), "rejected 2: bad span") {
		t.Fatalf("sendRaw = %v, want the rejection", err)
	}
}

// @scenario "an OTLP door refuses gRPC framing with 415"
func TestGRPCRefusalsPassOnlyOnA415(t *testing.T) {
	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		if strings.HasPrefix(r.Header.Get("Content-Type"), "application/grpc") {
			w.WriteHeader(http.StatusUnsupportedMediaType)
		}
	}))
	defer refusing.Close()
	grpc := 0
	for _, it := range ingestRun(t, refusing.URL, "refusals").refusalItems(ingestEnv{}) {
		if !strings.HasPrefix(it.id, "refusals-grpc") {
			continue
		}
		grpc++
		if ok, detail := prove(t, it); !ok {
			t.Errorf("%s: %s", it.id, detail)
		}
	}
	if grpc != 3 {
		t.Fatalf("gRPC refusals = %d, want one per door", grpc)
	}
	accepting := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { _, _ = io.Copy(io.Discard, r.Body) }))
	defer accepting.Close()
	items := ingestRun(t, accepting.URL, "refusals").refusalItems(ingestEnv{})
	if ok, detail := prove(t, items[0]); ok || detail != "answered 200, want 415" {
		t.Fatalf("a door taking gRPC framing: ok %v, %q", ok, detail)
	}
}

// @scenario "a family whose setup is missing is skipped and says why"
func TestFamiliesWithoutSetupAreSkipped(t *testing.T) {
	run := ingestRun(t, "http://127.0.0.1:1", "logs", "metrics", "gateway", "governance-source", "otlp-json")
	items := run.ingestItemsWith(readIngestEnv(func(string) string { return "" }))
	for _, family := range []string{"logs", "metrics", "gateway", "governance-source"} {
		if !strings.Contains(run.skipped[family], "WORKERRUN_") {
			t.Errorf("%s skipped %q, want the variable to set", family, run.skipped[family])
		}
	}
	if len(items) != run.options.N || items[0].family != "otlp-json" {
		t.Fatalf("items = %d, want only otlp-json's %d", len(items), run.options.N)
	}
}

// @scenario "the gateway family refuses a gateway that is not a local stack"
func TestGatewayRunsOnlyAgainstALocalStack(t *testing.T) {
	for gateway, refused := range map[string]bool{
		"https://api.openai.com":                         true,
		"https://gateway.main.langwatch.localhost":       false,
		"http://127.0.0.1:5563":                          false,
		"https://gateway.example.com.langwatch.attacker": true,
	} {
		if got := gatewayRefusal(ingestEnv{gatewayURL: gateway, gatewayKey: "vk"}) != ""; got != refused {
			t.Errorf("%s refused %v, want %v", gateway, got, refused)
		}
	}
}

// chServer answers every count with answer and keeps the last request's query and user.
type chServer struct {
	mu     sync.Mutex
	answer string
	query  string
	user   string
}

func (s *chServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.query = r.URL.RawQuery
	s.user, _, _ = r.BasicAuth()
	_, _ = io.WriteString(w, s.answer)
}

// @scenario "a hybrid run finds no row in the shared ClickHouse"
func TestHybridCountsPrivateAndFindsNoneShared(t *testing.T) {
	private := &chServer{answer: "3\n"}
	shared := &chServer{answer: "1\n"}
	privateServer, sharedServer := httptest.NewServer(private), httptest.NewServer(shared)
	defer privateServer.Close()
	defer sharedServer.Close()
	privateURL := strings.Replace(privateServer.URL, "http://", "http://reader:secret@", 1) + "/langwatch"
	targets, reason := newCHTargets(ingestEnv{clickhouse: privateURL, sharedClickhouse: sharedServer.URL}, http.DefaultClient)
	if reason != "" {
		t.Fatalf("targets: %s", reason)
	}
	query := chCount{table: "log_records", tenant: "project_test", marker: `"wrtest-logs-0000"`}
	if ok, detail := targets.proven(t.Context(), query, 3); ok || detail != "1 rows in the shared ClickHouse" {
		t.Fatalf("a leaked row: ok %v, %q", ok, detail)
	}
	shared.mu.Lock()
	shared.answer = "0\n"
	shared.mu.Unlock()
	if ok, detail := targets.proven(t.Context(), query, 3); !ok {
		t.Fatalf("private only: %s", detail)
	}
	private.mu.Lock()
	defer private.mu.Unlock()
	if private.user != "reader" || !strings.Contains(private.query, "database=langwatch") || !strings.Contains(private.query, "param_tenant=project_test") {
		t.Fatalf("private count sent user %q query %q", private.user, private.query)
	}
}

var hexTraceID = regexp.MustCompile(`^[0-9a-f]{32}$`)

// @scenario "OTLP JSON and gzip protobuf traces read back by id"
func TestOtlpJSONAndGzipReadBackByID(t *testing.T) {
	stack := &fakeStack{answer: `{"spans":[{"name":"agent.run"}]}`}
	server := httptest.NewServer(stack)
	defer server.Close()
	run := ingestRun(t, server.URL, "otlp-json", "otlp-gzip")
	run.options.N = 1
	for _, it := range run.ingestItemsWith(ingestEnv{}) {
		if ok, detail := prove(t, it); !ok {
			t.Errorf("%s: %s", it.id, detail)
		}
	}
	stack.mu.Lock()
	defer stack.mu.Unlock()
	if strings.Join(stack.sends, ",") != "application/json|,application/x-protobuf|gzip" {
		t.Errorf("sends = %v", stack.sends)
	}
	if len(stack.reads) != 2 || stack.reads[0] == stack.reads[1] || !hexTraceID.MatchString(stack.reads[0]) || !hexTraceID.MatchString(stack.reads[1]) {
		t.Fatalf("read back %v, want two distinct hex trace ids", stack.reads)
	}
}

var sessionEventsPath = regexp.MustCompile(`^/api/coding-agent/sessions/[0-9a-f]{16}/events$`)

// @scenario "Claude Code, Codex and other agent sessions read back"
func TestClaudeCodeSessionReadsBack(t *testing.T) {
	stack := &fakeStack{answer: `{"spans":[{"name":"claude_code.interaction"}]}`}
	server := httptest.NewServer(stack)
	defer server.Close()
	run := ingestRun(t, server.URL, "claude-code")
	run.options.N = 1
	items := run.ingestItemsWith(ingestEnv{})
	if len(items) != 1 {
		t.Fatalf("items = %d", len(items))
	}
	if ok, detail := prove(t, items[0]); !ok {
		t.Fatal(detail)
	}
	stack.mu.Lock()
	defer stack.mu.Unlock()
	if len(stack.reads) != 2 || !sessionEventsPath.MatchString(stack.reads[1]) {
		t.Fatalf("reads = %v, want the trace then the session's events", stack.reads)
	}
}

// @scenario "planted PII is not stored at the project's redaction level"
func TestPlantedPIIFailsTheItemWhenStored(t *testing.T) {
	for answer, want := range map[string]bool{
		`{"spans":[{"name":"agent.run","input":"contact [REDACTED] card [REDACTED]"}]}`: true,
		`{"spans":[{"name":"agent.run","input":"contact ` + plantedEmail + `"}]}`:       false,
	} {
		server := httptest.NewServer(&fakeStack{answer: answer})
		run := ingestRun(t, server.URL, "pii")
		run.options.N = 1
		items := run.ingestItemsWith(ingestEnv{})
		if ok, detail := prove(t, items[0]); ok != want {
			t.Errorf("answer %s: ok %v (%s), want %v", answer, ok, detail, want)
		}
		server.Close()
	}
}

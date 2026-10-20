package telemetrysim

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
)

// answeringDoor answers each request with the next of codes (the last repeats),
// adding Retry-After: 2 to a 429 or 503.
func answeringDoor(t *testing.T, codes ...int) string {
	t.Helper()
	var n atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		code := codes[min(int(n.Add(1))-1, len(codes)-1)]
		if code == http.StatusTooManyRequests || code == http.StatusServiceUnavailable {
			w.Header().Set("Retry-After", "2")
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = w.Write([]byte(`{"answered":"` + http.StatusText(code) + `"}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("%d %s: %v", rec.Code, rec.Body, err)
	}
	return v
}

// @scenario "A run reports its answers by status, the Retry-After it was given and its latency percentiles"
func TestARunCountsAnswersByStatusRetryAfterAndLatency(t *testing.T) {
	s := NewServer(Config{})
	endpoint := answeringDoor(t, http.StatusTooManyRequests, http.StatusOK, http.StatusUnsupportedMediaType, http.StatusServiceUnavailable)
	code, st := startRun(t, s, RunRequest{Mode: "send", Preset: "logs", Seed: 1, Batches: 3, Endpoint: endpoint})
	if code != http.StatusOK {
		t.Fatalf("send answered %d", code)
	}
	if st.ID != "run-1" || st.Answers[429] != 1 || st.Answers[200] != 1 || st.Answers[415] != 1 || st.Answers[503] != 3 {
		t.Errorf("id %q answers %v", st.ID, st.Answers)
	}
	if st.RetryAfterSeen != 4 || st.LastRetryAfter != "2" || st.Acked != 1 || st.Refused != 2 {
		t.Errorf("retry-after %d %q, acked %d refused %d", st.RetryAfterSeen, st.LastRetryAfter, st.Acked, st.Refused)
	}
	if st.Latency == nil || st.Latency.Samples != 6 || st.Latency.P50 > st.Latency.P99 || st.Latency.P99 > st.Latency.Max {
		t.Errorf("latency %+v", st.Latency)
	}
}

func TestLatencyPercentilesAreNearestRank(t *testing.T) {
	samples := make([]float64, 100)
	for i := range samples {
		samples[i] = float64(100 - i)
	}
	if l := latencyOf(samples); l.P50 != 50 || l.P90 != 90 || l.P99 != 99 || l.Max != 100 {
		t.Errorf("latency %+v", l)
	}
	if latencyOf(nil) != nil {
		t.Error("no samples should read as no latency")
	}
}

// @scenario "Runs are listed newest first and each opens by id with its mutations"
func TestRunsAreListedAndOpenByID(t *testing.T) {
	s := NewServer(Config{})
	_, endpoint := newDoor(t, always(http.StatusBadRequest))
	startRun(t, s, RunRequest{Mode: "send", Preset: "logs", Seed: 1, Endpoint: endpoint})
	startRun(t, s, RunRequest{Mode: "fuzz", Preset: "logs", Seed: 2, Budget: 3, Endpoint: endpoint})
	finished(t, s)

	runs := decode[map[string][]RunStatus](t, call(t, s, http.MethodGet, "/_sim/api/runs", nil))["runs"]
	if len(runs) != 2 || runs[0].ID != "run-2" || runs[1].ID != "run-1" || runs[0].Mutations != nil {
		t.Fatalf("runs %+v", runs)
	}
	for _, id := range []string{"run-2", "current"} {
		if got := decode[RunStatus](t, call(t, s, http.MethodGet, "/_sim/api/runs/"+id, nil)); got.ID != "run-2" || len(got.Mutations) != 3 {
			t.Errorf("%s: %+v", id, got)
		}
	}
	startRun(t, s, RunRequest{Mode: "send", Preset: "logs", Seed: 3, Endpoint: endpoint})
	if got := decode[RunStatus](t, call(t, s, http.MethodGet, "/_sim/api/runs/run-2", nil)); len(got.Mutations) != 3 {
		t.Errorf("a remembered fuzz run lost its mutations: %+v", got)
	}
	if rec := call(t, s, http.MethodGet, "/_sim/api/runs/run-9", nil); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown run answered %d, want 404", rec.Code)
	}
}

// @scenario "Send one posts a single OTLP request and shows the door's answer"
func TestSendOneShowsTheDoorsAnswer(t *testing.T) {
	s := NewServer(Config{Endpoint: answeringDoor(t, http.StatusTooManyRequests), APIKey: "sk-lw-never-shown"})
	rec := call(t, s, http.MethodPost, "/_sim/api/send-one", SendOneRequest{Preset: "metrics", Seed: 4, Encoding: EncodingJSON})
	got := decode[SendOneAnswer](t, rec)
	if rec.Code != http.StatusOK || got.Status != 429 || got.RetryAfter != "2" || got.Signal != SignalMetrics || !strings.HasSuffix(got.URL, "/v1/metrics") {
		t.Errorf("%d %+v", rec.Code, got)
	}
	if !strings.Contains(got.Body, "Too Many Requests") || got.Encoding != EncodingJSON || !got.Gzip || got.Bytes == 0 {
		t.Errorf("answer body %q, encoding %q, gzip %t, %d bytes", got.Body, got.Encoding, got.Gzip, got.Bytes)
	}
	if strings.Contains(rec.Body.String(), "sk-lw-never-shown") {
		t.Error("the answer carries the key")
	}
	if s.run != nil {
		t.Error("send one started a run")
	}
}

// @scenario "Send one converts a pasted OTLP JSON body and refuses one it cannot read"
func TestSendOneTakesAPastedBodyAndRefusesAMalformedOne(t *testing.T) {
	door, endpoint := newDoor(t, always(http.StatusOK))
	s := NewServer(Config{Endpoint: endpoint})
	pasted := `{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"body":{"stringValue":"hi"}}]}]}]}`
	rec := call(t, s, http.MethodPost, "/_sim/api/send-one", SendOneRequest{Body: pasted, NoGzip: true})
	if got := decode[SendOneAnswer](t, rec); got.Status != 200 || got.Signal != SignalLogs || got.Encoding != EncodingProtobuf {
		t.Errorf("%+v", got)
	}
	if bodies := door.received(); len(bodies) != 1 || strings.Contains(string(bodies[0]), "resourceLogs") {
		t.Errorf("the door got %d bodies; want one protobuf body", len(bodies))
	}
	for _, bad := range []SendOneRequest{
		{Body: `{"spans":[]}`},
		{Body: `not json`},
		{Body: `{"resourceSpans":[{"scopeSpans":"nope"}]}`},
		{Preset: "nope"},
		{Fixture: "claude-code/missing"},
		{Preset: "logs", Encoding: "xml"},
		{Preset: "logs", Endpoint: "ftp://door"},
	} {
		if rec := call(t, s, http.MethodPost, "/_sim/api/send-one", bad); rec.Code != http.StatusBadRequest {
			t.Errorf("%+v answered %d, want 400", bad, rec.Code)
		}
	}
	if len(door.received()) != 1 {
		t.Error("a refused request reached the door")
	}
}

// @scenario "The fixtures browser lists presets and recordings and shows each body"
func TestFixturesListPresetsAndRecordingsWithTheirBodies(t *testing.T) {
	_, endpoint := newDoor(t, always(http.StatusOK))
	s := NewServer(Config{Endpoint: endpoint})
	s.fixtures = fstest.MapFS{
		"README.md":                      {Data: []byte("# not a fixture")},
		"claude-code/session.otlp.json":  {Data: []byte(`{"resourceSpans":[]}`)},
		"codex/broken.otlp.json":         {Data: []byte(`[]`)},
		"claude-code/expected-only.json": {Data: []byte(`{}`)},
	}
	list := decode[map[string][]Fixture](t, call(t, s, http.MethodGet, "/_sim/api/fixtures", nil))["fixtures"]
	if len(list) != len(presets)+1 || list[len(list)-1].Name != "claude-code/session" || list[len(list)-1].Signal != SignalTraces {
		t.Fatalf("fixtures %+v", list)
	}
	preset := decode[FixtureBody](t, call(t, s, http.MethodGet, "/_sim/api/fixtures/llm-trace?seed=3", nil))
	if preset.Kind != "preset" || !strings.Contains(string(preset.Body), "resourceSpans") {
		t.Errorf("preset %+v", preset.Fixture)
	}
	recorded := decode[FixtureBody](t, call(t, s, http.MethodGet, "/_sim/api/fixtures/claude-code/session", nil))
	if recorded.Kind != "recorded" || recorded.Family != "claude-code" || string(recorded.Body) != `{"resourceSpans":[]}` {
		t.Errorf("recorded %+v %s", recorded.Fixture, recorded.Body)
	}
	if rec := call(t, s, http.MethodGet, "/_sim/api/fixtures/nope", nil); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown fixture answered %d", rec.Code)
	}
	sent := decode[SendOneAnswer](t, call(t, s, http.MethodPost, "/_sim/api/send-one", SendOneRequest{Fixture: "claude-code/session", Encoding: EncodingJSON}))
	if sent.Status != 200 || sent.Signal != SignalTraces {
		t.Errorf("sending a recording: %+v", sent)
	}
}

// @scenario "The setup shows the target, where the key came from and its project, never the key"
func TestStatusShowsTheKeySourceAndHintNeverTheKey(t *testing.T) {
	s := NewServer(Config{Stack: "feat-x", Endpoint: "http://door.test/api/otel", APIKey: "sk-lw-local-development-key", Project: "local-dev-org/local-dev-project"})
	rec := call(t, s, http.MethodGet, "/_sim/api/status", nil)
	st := decode[Status](t, rec)
	if st.KeySource != "TELEMETRYSIM_API_KEY" || st.KeyHint != "sk-lw-…-key" || st.Project != "local-dev-org/local-dev-project" {
		t.Errorf("status %+v", st)
	}
	if strings.Contains(rec.Body.String(), "local-development") {
		t.Error("the status carries the key")
	}
	if keyHint("short") != "set" || keyHint("") != "" {
		t.Error("a short key must not be shown in part")
	}
}

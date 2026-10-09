package telemetrysim

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	colllogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collmetricspb "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	colltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

var testStart = time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)

// door is a stub OTLP receiver that keeps every body and answers by request number.
type door struct {
	mu     sync.Mutex
	bodies [][]byte
	answer func(n int) int
}

func newDoor(t *testing.T, answer func(n int) int) (*door, string) {
	t.Helper()
	d := &door{answer: answer}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		d.mu.Lock()
		d.bodies = append(d.bodies, body)
		n := len(d.bodies)
		d.mu.Unlock()
		w.WriteHeader(d.answer(n))
	}))
	t.Cleanup(srv.Close)
	return d, srv.URL
}

func (d *door) received() [][]byte {
	d.mu.Lock()
	defer d.mu.Unlock()
	return slices.Clone(d.bodies)
}

func always(code int) func(int) int { return func(int) int { return code } }

func call(t *testing.T, s *Server, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(method, path, bytes.NewReader(encoded)))
	return rec
}

func startRun(t *testing.T, s *Server, req RunRequest) (int, RunStatus) {
	t.Helper()
	rec := call(t, s, http.MethodPost, "/_sim/api/runs", req)
	var st RunStatus
	_ = json.Unmarshal(rec.Body.Bytes(), &st)
	return rec.Code, st
}

func finished(t *testing.T, s *Server) RunStatus {
	t.Helper()
	s.mu.Lock()
	rn := s.run
	s.mu.Unlock()
	select {
	case <-rn.done:
	case <-time.After(10 * time.Second):
		t.Fatal("the run did not finish")
	}
	return rn.snapshot()
}

func gunzip(t *testing.T, body []byte) []byte {
	t.Helper()
	r, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// @scenario "A preset sends a seeded, reproducible batch"
func TestAPresetBuildsTheSameBytesFromTheSameSeed(t *testing.T) {
	for _, p := range presets {
		for _, enc := range []Encoding{EncodingProtobuf, EncodingJSON} {
			spec := BatchSpec{Preset: p, Seed: 42, Index: 3, Start: testStart, Encoding: enc, Gzip: true}
			a, errA := Build(spec)
			b, errB := Build(spec)
			if errA != nil || errB != nil {
				t.Fatalf("%s %s: %v %v", p.Name, enc, errA, errB)
			}
			if !bytes.Equal(a.Body, b.Body) {
				t.Errorf("%s %s: one seed built two different bodies", p.Name, enc)
			}
			spec.Seed = 43
			if c, _ := Build(spec); bytes.Equal(a.Body, c.Body) {
				t.Errorf("%s %s: seeds 42 and 43 built the same body", p.Name, enc)
			}
		}
	}
}

// @scenario "Presets cover traces, logs and metrics over OTLP HTTP in protobuf and JSON, gzipped"
func TestPresetsCoverEverySignalInBothEncodings(t *testing.T) {
	for _, name := range []string{"llm-trace", "claude-code-session", "codex-session", "logs", "metrics"} {
		if _, ok := presetByName(name); !ok {
			t.Errorf("no preset %q", name)
		}
	}
	hexTraceID := regexp.MustCompile(`"traceId":"[0-9a-f]{32}"`)
	seen := map[Signal]bool{}
	for _, p := range presets {
		seen[p.Signal] = true
		pb, err := Build(BatchSpec{Preset: p, Seed: 1, Start: testStart, Encoding: EncodingProtobuf, Gzip: true})
		if err != nil {
			t.Fatal(err)
		}
		msg := map[Signal]proto.Message{
			SignalTraces: &colltracepb.ExportTraceServiceRequest{}, SignalLogs: &colllogspb.ExportLogsServiceRequest{},
			SignalMetrics: &collmetricspb.ExportMetricsServiceRequest{},
		}[p.Signal]
		if err := proto.Unmarshal(gunzip(t, pb.Body), msg); err != nil || proto.Size(msg) == 0 {
			t.Errorf("%s: gzipped protobuf is no %s export request: %v", p.Name, p.Signal, err)
		}
		js, err := Build(BatchSpec{Preset: p, Seed: 1, Start: testStart, Encoding: EncodingJSON})
		if err != nil {
			t.Fatal(err)
		}
		if pb.ContentType != "application/x-protobuf" || js.ContentType != "application/json" || !pb.Gzip || js.Gzip {
			t.Errorf("%s: content types %q and %q", p.Name, pb.ContentType, js.ContentType)
		}
		if p.Signal != SignalMetrics && !hexTraceID.Match(js.Body) {
			t.Errorf("%s: JSON carries no hex trace id: %.200s", p.Name, js.Body)
		}
		if p.Signal == SignalTraces && !strings.Contains(string(js.Body), `"kind":`) || strings.Contains(string(js.Body), `"SPAN_KIND_`) {
			t.Errorf("%s: JSON span kinds are not numeric", p.Name)
		}
	}
	if len(seen) != 3 {
		t.Errorf("presets cover %v, want traces, logs and metrics", seen)
	}
}

// @scenario "A sustained run holds its target rate and reports sent, acked and refused counts"
func TestALoadRunHoldsItsRateAndCountsEveryBatchOnce(t *testing.T) {
	s := NewServer(Config{Stack: "test"})
	_, endpoint := newDoor(t, func(n int) int {
		if n%4 == 0 {
			return http.StatusBadRequest
		}
		return http.StatusOK
	})
	if code, _ := startRun(t, s, RunRequest{Mode: "load", Preset: "metrics", Seed: 3, Rate: 100, Duration: "300ms", Endpoint: endpoint}); code != http.StatusAccepted {
		t.Fatalf("load answered %d", code)
	}
	st := finished(t, s)
	if st.Sent < 10 || st.Sent > 31 {
		t.Errorf("sent %d batches in 300ms at 100/s, want about 30", st.Sent)
	}
	if st.Acked+st.Refused+st.Failed != st.Sent || st.Refused == 0 || st.Acked == 0 {
		t.Errorf("sent %d = acked %d + refused %d + failed %d, want both acked and refused", st.Sent, st.Acked, st.Refused, st.Failed)
	}
	if st.State != stateDone || st.TargetRate != 100 {
		t.Errorf("state %q, target rate %v", st.State, st.TargetRate)
	}
}

// @scenario "Fuzzing mutates within a seeded budget and records each mutation id for replay"
func TestFuzzRecordsMutationIDsThatReplayTheExactBytes(t *testing.T) {
	runFuzz := func() (RunStatus, [][]byte) {
		s := NewServer(Config{})
		d, endpoint := newDoor(t, always(http.StatusOK))
		startRun(t, s, RunRequest{Mode: "fuzz", Preset: "llm-trace", Seed: 9, Budget: 20, Endpoint: endpoint})
		return finished(t, s), d.received()
	}
	first, bodies := runFuzz()
	second, _ := runFuzz()
	if len(first.Mutations) != 20 || len(bodies) != 20 {
		t.Fatalf("recorded %d mutations over %d sends, want 20", len(first.Mutations), len(bodies))
	}
	for k, m := range first.Mutations {
		if second.Mutations[k].ID != m.ID {
			t.Errorf("case %d: %s then %s under one seed", k, m.ID, second.Mutations[k].ID)
		}
		preset, seed, index, err := ParseMutationID(m.ID)
		if err != nil {
			t.Fatal(err)
		}
		id, replay, err := FuzzCase(BatchSpec{Preset: preset, Seed: seed, Index: index, Start: first.StartedAt, Encoding: EncodingProtobuf, Gzip: true})
		if err != nil || id != m.ID || !bytes.Equal(replay.Body, bodies[k]) {
			t.Errorf("case %s did not replay the bytes the door received (got id %s, err %v)", m.ID, id, err)
		}
	}
}

// @scenario "A refused send is counted and not retried forever"
func TestARefusedSendIsCountedAndRetriedAtMostTwice(t *testing.T) {
	for _, tc := range []struct{ answer, attempts int }{{http.StatusServiceUnavailable, 1 + maxRetries}, {http.StatusBadRequest, 1}} {
		s := NewServer(Config{})
		d, endpoint := newDoor(t, always(tc.answer))
		code, st := startRun(t, s, RunRequest{Mode: "send", Preset: "logs", Seed: 1, Endpoint: endpoint})
		if code != http.StatusOK || st.Sent != 1 || st.Refused != 1 || st.Acked != 0 {
			t.Errorf("%d: answered %d with sent %d refused %d acked %d", tc.answer, code, st.Sent, st.Refused, st.Acked)
		}
		if got := len(d.received()); got != tc.attempts {
			t.Errorf("%d: the door saw %d attempts, want %d", tc.answer, got, tc.attempts)
		}
	}
}

// @scenario "The control API starts, stops and reports a run"
func TestTheControlAPIStartsStopsAndNeverShowsTheKey(t *testing.T) {
	s := NewServer(Config{Stack: "test"})
	_, endpoint := newDoor(t, always(http.StatusOK))
	req := RunRequest{Mode: "load", Preset: "codex-session", Rate: 20, Duration: "1h", Endpoint: endpoint, APIKey: "sk-lw-never-shown"}
	if code, _ := startRun(t, s, req); code != http.StatusAccepted {
		t.Fatalf("load answered %d", code)
	}
	if code, _ := startRun(t, s, req); code != http.StatusConflict {
		t.Errorf("a second run answered %d, want 409", code)
	}
	time.Sleep(120 * time.Millisecond)
	stop := call(t, s, http.MethodDelete, "/_sim/api/runs/current", nil)
	status := call(t, s, http.MethodGet, "/_sim/api/status", nil)
	var st Status
	if err := json.Unmarshal(status.Body.Bytes(), &st); err != nil || st.Run == nil {
		t.Fatalf("status %s: %v", status.Body, err)
	}
	if stop.Code != http.StatusOK || st.Run.State != stateStopped || st.Run.Sent == 0 {
		t.Errorf("stop answered %d; run %q after %d sends", stop.Code, st.Run.State, st.Run.Sent)
	}
	if strings.Contains(stop.Body.String()+status.Body.String(), "sk-lw-never-shown") {
		t.Error("the status carries the project key")
	}
	if code, _ := startRun(t, s, RunRequest{Mode: "send", Preset: "nope", Endpoint: endpoint}); code != http.StatusBadRequest {
		t.Errorf("an unknown preset answered %d, want 400", code)
	}
}

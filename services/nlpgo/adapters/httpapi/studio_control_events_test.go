package httpapi

import (
	"bufio"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// Tests pin the Studio-control event short-circuit on /go/studio/execute.
//
// Closes the dogfood gap caught while QA'ing PR #3483 against a clean
// dev env (NLPGO_CHILD_BYPASS=true): pre-fix Studio's `is_alive`
// heartbeat (every ~7s) and `stop_execution` (on Stop click) both
// routed through the legacy `/studio/execute` path even when the FF
// was on, so any operator running without the Python sidecar saw
// perpetual "Connecting…" and a misleading "Bad Gateway child upstream
// unavailable" toast every tick. Counterpart TS change is in
// langwatch/src/app/api/workflows/post_event/post-event.ts (added
// is_alive + stop_execution to GO_ENGINE_EVENT_TYPES).
//
// Wire shape contract from the Python sidecar (preserved here):
//   - is_alive       → frame `is_alive_response`, then frame `done`
//   - stop_execution → frame `done` only
//
// Both frames are payload-less; Studio's usePostEvent.tsx switches on
// type alone for is_alive_response and ignores done.

// extractFrameTypes splits SSE wire bytes into ordered `type` strings
// from each `data: {…}` line so test assertions don't depend on byte
// equality (whitespace, key order, etc).
func extractFrameTypes(t *testing.T, raw string) []string {
	t.Helper()
	var types []string
	scanner := bufio.NewScanner(strings.NewReader(raw))
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var frame struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &frame); err != nil {
			t.Fatalf("could not parse SSE frame %q: %v", line, err)
		}
		types = append(types, frame.Type)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner error: %v", err)
	}
	return types
}

func TestEmitStudioControlEvent_IsAliveAnswersWithIsAliveResponseThenDone(t *testing.T) {
	rec, flusher := newRecorder()
	// emitStudioControlEvent uses w.(http.Flusher); httptest.ResponseRecorder
	// doesn't implement it, so wrap via the same fakeFlusher that
	// sse_writer_test uses.
	_ = flusher
	emitStudioControlEvent(&recorderWithFlusher{ResponseRecorder: rec}, "is_alive")

	if got := rec.Result().StatusCode; got != 200 {
		t.Fatalf("status = %d; want 200", got)
	}
	if ct := rec.Result().Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("Content-Type = %q; want text/event-stream", ct)
	}

	types := extractFrameTypes(t, rec.Body.String())
	want := []string{"is_alive_response", "done"}
	if len(types) != len(want) {
		t.Fatalf("frame count = %d; want %d (got types %v)", len(types), len(want), types)
	}
	for i, w := range want {
		if types[i] != w {
			t.Errorf("frame[%d] = %q; want %q", i, types[i], w)
		}
	}

	// Frames must be payload-less — Studio's reducer switches on type
	// alone for these control events.
	if strings.Contains(rec.Body.String(), `"payload"`) {
		t.Errorf("control frames must not carry a payload; got body %q", rec.Body.String())
	}
}

func TestEmitStudioControlEvent_StopExecutionAnswersWithDoneOnly(t *testing.T) {
	rec, flusher := newRecorder()
	_ = flusher
	emitStudioControlEvent(&recorderWithFlusher{ResponseRecorder: rec}, "stop_execution")

	if got := rec.Result().StatusCode; got != 200 {
		t.Fatalf("status = %d; want 200", got)
	}

	types := extractFrameTypes(t, rec.Body.String())
	if len(types) != 1 || types[0] != "done" {
		t.Fatalf("frames = %v; want [done]", types)
	}
}

func TestPeekStudioControlEventType_RecognizesIsAliveAndStopExecution(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"is_alive", `{"type":"is_alive","payload":{}}`, "is_alive"},
		{"stop_execution", `{"type":"stop_execution","payload":{"trace_id":"t-1"}}`, "stop_execution"},

		// The execute_* events MUST fall through (return "") so the
		// regular workflow decoder runs. If a refactor accidentally
		// folded those into the control path, customers' workflows
		// would silently emit just `done` without running.
		{"execute_flow falls through", `{"type":"execute_flow","payload":{"workflow":{}}}`, ""},
		{"execute_component falls through", `{"type":"execute_component","payload":{"workflow":{}}}`, ""},
		{"execute_evaluation falls through", `{"type":"execute_evaluation","payload":{"workflow":{}}}`, ""},

		// Flat envelope (no top-level type) → not control.
		{"flat envelope", `{"trace_id":"t","workflow":{}}`, ""},

		// Malformed JSON → not control; let the regular decoder
		// surface the structured error.
		{"malformed", `not json`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := peekStudioControlEventType([]byte(tc.body)); got != tc.want {
				t.Fatalf("peek(%s) = %q; want %q", tc.name, got, tc.want)
			}
		})
	}
}

// recorderWithFlusher composes the test recorder with a Flush so it
// satisfies http.ResponseWriter AND http.Flusher in the same value
// (emitStudioControlEvent type-asserts via w.(http.Flusher)).
type recorderWithFlusher struct {
	*httptest.ResponseRecorder
}

func (r *recorderWithFlusher) Flush() {}

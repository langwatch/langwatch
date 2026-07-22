package opencode

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

func portOf(t *testing.T, serverURL string) int {
	t.Helper()
	port, err := strconv.Atoi(strings.TrimPrefix(serverURL, "http://127.0.0.1:"))
	if err != nil {
		t.Fatalf("parse port from %q: %v", serverURL, err)
	}
	return port
}

// requireOpenCodeAuthEnforced is the Fix A′ fail-closed guard (ADR-033): if
// opencode is genuinely requiring auth, an unauthenticated probe gets 401 and
// the guard passes.
func TestRequireOpenCodeAuthEnforced_PassesWhenBackendReturns401(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer backend.Close()

	if err := requireOpenCodeAuthEnforced(context.Background(), portOf(t, backend.URL)); err != nil {
		t.Fatalf("expected nil error when opencode requires auth, got %v", err)
	}
}

// If opencode ever stops honoring OPENCODE_SERVER_PASSWORD, an unauthenticated
// request would get 200 instead of 401 — the sibling-isolation guarantee would
// be silently void. The guard must refuse to consider the worker ready.
func TestRequireOpenCodeAuthEnforced_FailsWhenBackendIsUnauthenticated(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	if err := requireOpenCodeAuthEnforced(context.Background(), portOf(t, backend.URL)); err == nil {
		t.Fatalf("expected an error when opencode answers an unauthenticated request with 200")
	}
}

// WaitForReadiness must fail closed if the proxy chain is up but the underlying
// opencode doesn't actually require auth — booting the worker in that state
// would mean any sibling can reach it unauthenticated.
func TestWaitForReadiness_FailsIfInternalPortIsUnauthenticated(t *testing.T) {
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer external.Close()

	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK) // bug scenario: opencode not enforcing auth
	}))
	defer internal.Close()

	err := WaitForReadiness(context.Background(), portOf(t, external.URL), portOf(t, internal.URL), "bearer", time.Second)
	if err == nil {
		t.Fatalf("expected WaitForReadiness to fail closed when the internal port doesn't require auth")
	}
}

func TestWaitForReadiness_SucceedsWhenProxyUpAndInternalPortEnforcesAuth(t *testing.T) {
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer external.Close()

	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer internal.Close()

	err := WaitForReadiness(context.Background(), portOf(t, external.URL), portOf(t, internal.URL), "bearer", time.Second)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
}

// Regression for the spawn race: StartAuthProxy binds and serves synchronously,
// but opencode's listener on internalPort comes up later. Before it's
// listening, the proxy's ErrorHandler answers polls with a genuine 502 — a
// real, err==nil HTTP response, not a transport failure. WaitForReadiness must
// not mistake that for "ready": doing so triggers a one-shot
// requireOpenCodeAuthEnforced probe against a port nothing is listening on yet.
// In production the proxy always wins this race against opencode's startup.
func TestWaitForReadiness_SurvivesProxy502BeforeBackendListens(t *testing.T) {
	internalPort, err := GetFreePort()
	if err != nil {
		t.Fatalf("reserve internal port: %v", err)
	}
	externalPort, err := GetFreePort()
	if err != nil {
		t.Fatalf("reserve external port: %v", err)
	}

	proxy, err := StartAuthProxy(context.Background(), externalPort, internalPort, "bearer", "opencode-pw")
	if err != nil {
		t.Fatalf("start auth proxy: %v", err)
	}
	defer proxy.Shutdown()

	// Nothing listens on internalPort yet — the proxy's first polls hit
	// connection-refused and answer 502. Only after a delay does the "opencode"
	// backend start listening, simulating its real startup time.
	backend := &http.Server{
		Addr: fmt.Sprintf("127.0.0.1:%d", internalPort),
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		}),
	}
	defer backend.Close()
	go func() {
		time.Sleep(150 * time.Millisecond)
		l, err := net.Listen("tcp", backend.Addr)
		if err != nil {
			return
		}
		_ = backend.Serve(l)
	}()

	err = WaitForReadiness(context.Background(), externalPort, internalPort, "bearer", 2*time.Second)
	if err != nil {
		t.Fatalf("expected WaitForReadiness to survive the proxy's pre-backend 502s and succeed once opencode starts listening, got %v", err)
	}
}

// decodeSSE mirrors the streaming decode path: unmarshal a raw /event payload
// into the typed sseEvent used for routing + terminal detection.
func decodeSSE(t *testing.T, payload string) *sseEvent {
	t.Helper()
	var ev sseEvent
	if err := json.Unmarshal([]byte(payload), &ev); err != nil {
		t.Fatalf("decode %q: %v", payload, err)
	}
	return &ev
}

// OpenCode has emitted the session id under three top-level keys and two nested
// under "properties" across versions. The typed decode + eventBelongsToSession
// must route ALL of them (and only to the matching session).
func TestEventBelongsToSession_DecodesEverySessionIDVariant(t *testing.T) {
	cases := []struct {
		name    string
		payload string
	}{
		{"top-level sessionID", `{"type":"message.part.delta","sessionID":"s1"}`},
		{"top-level sessionId", `{"type":"message.part.delta","sessionId":"s1"}`},
		{"top-level session_id", `{"type":"message.part.delta","session_id":"s1"}`},
		{"properties.sessionID", `{"type":"message.part.delta","properties":{"sessionID":"s1"}}`},
		{"properties.sessionId", `{"type":"message.part.delta","properties":{"sessionId":"s1"}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ev := decodeSSE(t, tc.payload)
			if !eventBelongsToSession(ev, "s1") {
				t.Errorf("expected %s to route to s1", tc.name)
			}
			if eventBelongsToSession(ev, "other") {
				t.Errorf("expected %s NOT to route to a different session", tc.name)
			}
		})
	}
}

func TestEventBelongsToSession_EmptyTargetRejects(t *testing.T) {
	// An empty sessionID must never match — otherwise events from a worker whose
	// session id we don't yet know would be forwarded blindly.
	ev := decodeSSE(t, `{"sessionID":"s1"}`)
	if eventBelongsToSession(ev, "") {
		t.Errorf("expected empty sessionID to reject")
	}
}

func TestEventBelongsToSession_UnknownFieldsIgnored(t *testing.T) {
	// The typed decode must skip the bulk of an opencode event (unknown fields)
	// without error and still route by session + expose the type.
	ev := decodeSSE(t, `{"type":"message.part.delta","sessionID":"s2","part":{"text":"hi"},"extra":123}`)
	if !eventBelongsToSession(ev, "s2") {
		t.Errorf("unknown fields must be ignored and the event still routed")
	}
	if ev.Type != "message.part.delta" {
		t.Errorf("Type = %q, want message.part.delta", ev.Type)
	}
}

// Terminal detection runs off the decoded Type — the decode must surface it for
// each terminal variant so the stream closes (and NOT for a delta).
func TestSSEDecode_TerminalTypeDetected(t *testing.T) {
	for _, typ := range []string{"message.completed", "message.done", "session.idle", "session.completed", "error", "session.error", "message.error"} {
		ev := decodeSSE(t, `{"type":"`+typ+`","sessionID":"s1"}`)
		if _, terminal := terminalEventTypes[ev.Type]; !terminal {
			t.Errorf("decoded type %q should be terminal", typ)
		}
	}
	ev := decodeSSE(t, `{"type":"message.part.delta","sessionID":"s1"}`)
	if _, terminal := terminalEventTypes[ev.Type]; terminal {
		t.Errorf("message.part.delta must NOT be terminal")
	}
}

// collectFrames runs StreamSession against srv and returns the JSON payloads of
// the frames it emitted (in order), so a test asserts the frames union the manager
// produces rather than a verbatim ndjson dump.
func collectFrames(t *testing.T, srvURL, session string) []string {
	t.Helper()
	var mu sync.Mutex
	var got []string
	err := StreamSession(context.Background(), srvURL, "bearer", session, func(f frames.Frame) error {
		mu.Lock()
		got = append(got, f.JSON())
		mu.Unlock()
		return nil
	})
	if err != nil {
		t.Fatalf("StreamSession: %v", err)
	}
	return got
}

func frameType(t *testing.T, line string) string {
	t.Helper()
	var p struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal([]byte(line), &p); err != nil {
		t.Fatalf("frame not valid json %q: %v", line, err)
	}
	return p.Type
}

// StreamSession must emit OUR session's frames (a delta), filter a sibling
// session's events (the read-side isolation guarantee), and stop at the terminal
// event WITHOUT itself emitting a terminal frame (app.Chat emits the final).
func TestStreamSession_EmitsOwnSessionFramesAndFiltersSibling(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/event" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		fl, _ := w.(http.Flusher)
		emit := func(s string) {
			fmt.Fprintf(w, "data: %s\n", s)
			if fl != nil {
				fl.Flush()
			}
		}
		emit(`{"type":"message.part.delta","properties":{"sessionID":"mine","field":"text","delta":"hello"}}`)
		emit(`{"type":"message.part.delta","properties":{"sessionID":"sibling","field":"text","delta":"leak?"}}`)
		emit(`{"type":"message.completed","sessionID":"mine"}`)
	}))
	defer srv.Close()

	got := collectFrames(t, srv.URL, "mine")

	var deltas []string
	for _, line := range got {
		if strings.Contains(line, "leak") {
			t.Errorf("a sibling session's event must NOT be emitted, got %q", line)
		}
		switch frameType(t, line) {
		case "delta":
			var d struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal([]byte(line), &d)
			deltas = append(deltas, d.Text)
		case "final", "error":
			t.Errorf("StreamSession must not emit a terminal frame on normal completion, got %q", line)
		}
	}
	if len(deltas) != 1 || deltas[0] != "hello" {
		t.Errorf("expected exactly one delta %q, got %v", "hello", deltas)
	}
}

// An opencode error event must terminate the stream with ErrAgentReportedError
// — in ALL three spellings, and even when the event carries NO session id (a
// provider-rejection error is emitted before the session is attached; the
// worker serves one conversation, so an unrouted error can only be ours).
// Missing it left the turn silent until the liveness sweep misread a
// deterministic failure as a 90s stall.
func TestStreamSession_ErrorEventTerminatesWithAgentError(t *testing.T) {
	cases := []struct {
		name  string
		event string
	}{
		{"error with session", `{"type":"error","sessionID":"mine","error":"provider is required"}`},
		{"session.error without session id", `{"type":"session.error","properties":{"error":"AI_APICallError: provider is required"}}`},
		{"message.error without session id", `{"type":"message.error","message":"stream error"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fl, _ := w.(http.Flusher)
				fmt.Fprintf(w, "data: %s\n", tc.event)
				if fl != nil {
					fl.Flush()
				}
			}))
			defer srv.Close()

			err := StreamSession(context.Background(), srv.URL, "bearer", "mine", func(frames.Frame) error { return nil })
			if !herr.IsCode(err, domain.ErrAgentError) {
				t.Fatalf("expected agent_error herr, got %v", err)
			}
			// The raw opencode prose rides as an UNKNOWN reason (log-only): the
			// herr's own code stays the vetted agent_error, and herr.Body would
			// collapse the reason to "unknown" on any wire.
			if body := herr.Body(err); body.Type != string(domain.ErrAgentError) {
				t.Fatalf("expected wire type agent_error, got %q", body.Type)
			}
		})
	}
}

// A sibling session's error must still be filtered: the no-session-id tolerance
// applies only when the event names NO session at all.
func TestStreamSession_SiblingErrorEventStillFiltered(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fl, _ := w.(http.Flusher)
		emit := func(s string) {
			fmt.Fprintf(w, "data: %s\n", s)
			if fl != nil {
				fl.Flush()
			}
		}
		emit(`{"type":"session.error","sessionID":"sibling","error":"their problem"}`)
		emit(`{"type":"message.completed","sessionID":"mine"}`)
	}))
	defer srv.Close()

	err := StreamSession(context.Background(), srv.URL, "bearer", "mine", func(frames.Frame) error { return nil })
	if err != nil {
		t.Fatalf("a sibling's error must not fail our turn, got %v", err)
	}
}

func TestTextDeltaFromEvent_MessagePartDelta(t *testing.T) {
	// The current opencode shape: message.part.delta with a text field carries a
	// token in properties.delta. This is the Stream B fast-path source (ADR-048).
	ev := decodeSSE(t, `{"type":"message.part.delta","properties":{"sessionID":"s1","field":"text","delta":"Hel"}}`)
	got, ok := textDeltaFromEvent(ev)
	if !ok || got != "Hel" {
		t.Errorf("expected delta %q ok=true, got %q ok=%v", "Hel", got, ok)
	}
}

func TestTextDeltaFromEvent_LegacyTextShape(t *testing.T) {
	ev := decodeSSE(t, `{"type":"text","part":{"text":"world"}}`)
	got, ok := textDeltaFromEvent(ev)
	if !ok || got != "world" {
		t.Errorf("expected delta %q ok=true, got %q ok=%v", "world", got, ok)
	}
}

func TestReasoningDeltaFromEvent_MessagePartDelta(t *testing.T) {
	// opencode streams reasoning as a message.part.delta with field=="reasoning"
	// — the SAME shape the text fast-path rejects (see the non-text case below).
	ev := decodeSSE(t, `{"type":"message.part.delta","properties":{"sessionID":"s1","field":"reasoning","delta":"weighing options"}}`)
	got, ok := reasoningDeltaFromEvent(ev)
	if !ok || got != "weighing options" {
		t.Errorf("expected reasoning %q ok=true, got %q ok=%v", "weighing options", got, ok)
	}
}

func TestReasoningDeltaFromEvent_NonReasoningYieldsNothing(t *testing.T) {
	// A text delta is NOT reasoning, and an empty reasoning delta is not a frame.
	cases := []string{
		`{"type":"message.part.delta","properties":{"field":"text","delta":"hi"}}`,
		`{"type":"message.part.delta","properties":{"field":"reasoning","delta":""}}`,
		`{"type":"text","part":{"text":"world"}}`,
	}
	for _, raw := range cases {
		ev := decodeSSE(t, raw)
		if got, ok := reasoningDeltaFromEvent(ev); ok {
			t.Errorf("expected no reasoning for %s, got %q", raw, got)
		}
	}
}

func TestTextDeltaFromEvent_NonTextEventsYieldNothing(t *testing.T) {
	// Tool-call / lifecycle / non-text-field deltas must NOT produce a fast
	// frame — Stream B is raw answer tokens only.
	cases := []string{
		`{"type":"message.completed"}`,
		`{"type":"tool.call","properties":{"name":"search_traces"}}`,
		`{"type":"message.part.delta","properties":{"field":"reasoning","delta":"x"}}`,
		`{"type":"message.part.delta","properties":{"field":"text","delta":""}}`,
		`{"type":"text","part":{"text":""}}`,
	}
	for _, raw := range cases {
		ev := decodeSSE(t, raw)
		if got, ok := textDeltaFromEvent(ev); ok {
			t.Errorf("expected no delta for %s, got %q", raw, got)
		}
	}
}

func TestTerminalEventTypes_Present(t *testing.T) {
	for _, name := range []string{
		"message.completed",
		"message.done",
		"session.idle",
		"session.completed",
		"error",
	} {
		if _, ok := terminalEventTypes[name]; !ok {
			t.Errorf("expected %q to be a terminal event type", name)
		}
	}
}

// The guard must probe a real CONTROL endpoint, not just `/`. A worker where the
// root route returns 401 but the actual control API (POST /session) is reachable
// unauthenticated is exactly the cross-worker exposure ADR-033 closes — the
// guard must refuse to start it even though `/` looks protected.
func TestRequireOpenCodeAuthEnforced_FailsWhenControlEndpointReachableEvenIfRootIs401(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/session" {
			w.WriteHeader(http.StatusOK) // control plane accidentally exposed
			return
		}
		w.WriteHeader(http.StatusUnauthorized) // root looks protected
	}))
	defer backend.Close()

	if err := requireOpenCodeAuthEnforced(context.Background(), portOf(t, backend.URL)); err == nil {
		t.Fatalf("expected the guard to fail when POST /session is reachable unauthenticated, even though / returns 401")
	}
}

// toolFrame is the consumer's view of a tool ndjson frame — decoded exactly
// as the control plane would. Pointers on the optional fields so a test can tell
// "absent" from "present and false/empty", which is the whole point of the
// start/end wire contract.
type toolFrame struct {
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Phase   string          `json:"phase"`
	Title   string          `json:"title"`
	Input   json.RawMessage `json:"input"`
	Output  *string         `json:"output"`
	IsError *bool           `json:"isError"`
}

// A realistic opencode tool part, as it lands on /event: the part rides under
// `properties.part` on a `message.part.updated`, carries its identity on
// `tool` + `callID`, and transitions pending -> running -> completed | error on
// `state.status`.
func toolEvent(session, callID, tool, state string) string {
	return fmt.Sprintf(
		`{"type":"message.part.updated","properties":{"sessionID":%q,"part":{"id":"prt_01","messageID":"msg_01","sessionID":%q,"type":"tool","callID":%q,"tool":%q,"state":%s}}}`,
		session, session, callID, tool, state,
	)
}

// emitFrames runs one raw opencode event through the tracker and returns the
// frames AS THEY GO ON THE WIRE — marshalled and decoded back — so the
// assertions cover the real ndjson contract (which optional fields are omitted),
// not just the in-memory struct.
func emitFrames(t *testing.T, tracker *toolCallTracker, payload string) []toolFrame {
	t.Helper()
	var out []toolFrame
	for _, f := range tracker.framesFor(decodeSSE(t, payload)) {
		var decoded toolFrame
		if err := json.Unmarshal([]byte(f.JSON()), &decoded); err != nil {
			t.Fatalf("decode frame %s: %v", f.JSON(), err)
		}
		out = append(out, decoded)
	}
	return out
}

func onlyFrame(t *testing.T, frames []toolFrame) toolFrame {
	t.Helper()
	if len(frames) != 1 {
		t.Fatalf("expected exactly 1 frame, got %d: %+v", len(frames), frames)
	}
	return frames[0]
}

// The `running` transition is the first one that exposes the tool's name AND the
// args it was called with — that is what opens the card.
func TestToolCallTracker_RunningPartEmitsStartFrame(t *testing.T) {
	tracker := newToolCallTracker()
	frames := emitFrames(t, tracker, toolEvent("s1", "call_1", "search_traces",
		`{"status":"running","title":"Searching traces","input":{"query":"errors"}}`))

	f := onlyFrame(t, frames)
	if f.Type != "tool" || f.Phase != "start" {
		t.Errorf("expected a tool start frame, got type=%q phase=%q", f.Type, f.Phase)
	}
	if f.ID != "call_1" || f.Name != "search_traces" {
		t.Errorf("id/name = %q/%q, want call_1/search_traces", f.ID, f.Name)
	}
	if f.Title != "Searching traces" {
		t.Errorf("title = %q, want %q", f.Title, "Searching traces")
	}
	if string(f.Input) != `{"query":"errors"}` {
		t.Errorf("input = %s, want the tool args verbatim", f.Input)
	}
	// A start is not a settle — it must carry neither a result nor an error verdict.
	if f.Output != nil || f.IsError != nil {
		t.Errorf("a start frame must omit output + isError, got output=%v isError=%v", f.Output, f.IsError)
	}
}

// THE PRODUCTION SHAPE, and the one every fixture in this file used to miss.
//
// opencode announces `running` before the arguments exist — input `{}` — and then
// RE-SENDS the same `running` with them filled in. The tracker opened the card on
// that first empty one and then dropped the re-send as a duplicate, so the command
// reached the control plane on NO frame: not the start, not the end. Downstream,
// `bash("langwatch trace search")` could never be re-typed into the capability it
// was, and the panel, having nothing to label the card with, fell back to the
// tool's own name and sat there saying "Bash…" for the length of the turn.
//
// The card must open on the frame that KNOWS the command, not the first one to
// claim it is running.
func TestToolCallTracker_RunningWithEmptyInputWaitsForTheRealArgs(t *testing.T) {
	tracker := newToolCallTracker()

	// opencode: "I'm running" — but it cannot yet say what.
	if frames := emitFrames(t, tracker, toolEvent("s1", "call_1", "bash",
		`{"status":"running","input":{}}`)); len(frames) != 0 {
		t.Fatalf("a running part with an empty input knows no command yet and must not open a card, got %+v", frames)
	}

	// opencode re-sends the same running state, now carrying the command.
	f := onlyFrame(t, emitFrames(t, tracker, toolEvent("s1", "call_1", "bash",
		`{"status":"running","input":{"command":"langwatch trace search"}}`)))

	if f.Phase != "start" {
		t.Fatalf("phase = %q, want the start we deferred", f.Phase)
	}
	if string(f.Input) != `{"command":"langwatch trace search"}` {
		t.Errorf("input = %s, want the command verbatim — this is the field the whole card hangs off", f.Input)
	}
}

// A tool whose input is genuinely empty must still be reported. Waiting for args
// that are never coming would strand the card, so the settle transition emits the
// start we withheld — the card opens late rather than never.
func TestToolCallTracker_GenuinelyEmptyInputStillSettles(t *testing.T) {
	tracker := newToolCallTracker()

	if frames := emitFrames(t, tracker, toolEvent("s1", "call_1", "list_projects",
		`{"status":"running","input":{}}`)); len(frames) != 0 {
		t.Fatalf("expected the start to be withheld, got %+v", frames)
	}

	frames := emitFrames(t, tracker, toolEvent("s1", "call_1", "list_projects",
		`{"status":"completed","input":{},"output":"2 projects"}`))
	if len(frames) != 2 {
		t.Fatalf("a withheld start must be emitted at settle, want start+end, got %+v", frames)
	}
	if frames[0].Phase != "start" || frames[1].Phase != "end" {
		t.Errorf("want start then end, got %q then %q", frames[0].Phase, frames[1].Phase)
	}
}

// The end frame carries the input too, so one event answers both "what ran?" and
// "how did it go?" — for the card, for the event log, and for anyone debugging a
// turn after the fact.
func TestToolCallTracker_EndFrameCarriesTheInput(t *testing.T) {
	tracker := newToolCallTracker()
	emitFrames(t, tracker, toolEvent("s1", "call_1", "bash",
		`{"status":"running","input":{"command":"langwatch trace search"}}`))

	frames := emitFrames(t, tracker, toolEvent("s1", "call_1", "bash",
		`{"status":"completed","input":{"command":"langwatch trace search"},"output":"3 traces"}`))

	end := frames[len(frames)-1]
	if end.Phase != "end" {
		t.Fatalf("phase = %q, want end", end.Phase)
	}
	if string(end.Input) != `{"command":"langwatch trace search"}` {
		t.Errorf("end input = %s, want the command — an end event must identify itself", end.Input)
	}
}

// `pending` carries neither input nor title — opening the card on it would strand
// the card with no args. The start waits for `running`.
func TestToolCallTracker_PendingPartEmitsNothing(t *testing.T) {
	tracker := newToolCallTracker()
	if frames := emitFrames(t, tracker, toolEvent("s1", "call_1", "read", `{"status":"pending"}`)); len(frames) != 0 {
		t.Errorf("expected no frame for a pending tool part, got %+v", frames)
	}
}

func TestToolCallTracker_CompletedPartEmitsEndFrameWithoutError(t *testing.T) {
	tracker := newToolCallTracker()
	// The card is already open — the settle transition closes it.
	emitFrames(t, tracker, toolEvent("s1", "call_1", "search_traces",
		`{"status":"running","input":{"query":"errors"}}`))

	frames := emitFrames(t, tracker, toolEvent("s1", "call_1", "search_traces",
		`{"status":"completed","input":{"query":"errors"},"output":"3 traces found","time":{"start":1,"end":2}}`))

	f := onlyFrame(t, frames)
	if f.Phase != "end" {
		t.Fatalf("phase = %q, want end", f.Phase)
	}
	if f.ID != "call_1" {
		t.Errorf("the end frame must carry the SAME id as its start, got %q", f.ID)
	}
	if f.Output == nil || *f.Output != "3 traces found" {
		t.Errorf("output = %v, want %q", f.Output, "3 traces found")
	}
	// isError is meaningful on an end even when false — it must be on the wire.
	if f.IsError == nil {
		t.Fatalf("an end frame must always carry isError, it was omitted")
	}
	if *f.IsError {
		t.Errorf("isError = true, want false for a completed tool")
	}
}

func TestToolCallTracker_ErrorPartEmitsEndFrameWithErrorMessage(t *testing.T) {
	tracker := newToolCallTracker()
	emitFrames(t, tracker, toolEvent("s1", "call_2", "bash", `{"status":"running","input":{"command":"false"}}`))

	frames := emitFrames(t, tracker, toolEvent("s1", "call_2", "bash",
		`{"status":"error","input":{"command":"false"},"error":"exit status 1"}`))

	f := onlyFrame(t, frames)
	if f.Phase != "end" {
		t.Fatalf("phase = %q, want end", f.Phase)
	}
	if f.IsError == nil || !*f.IsError {
		t.Errorf("isError = %v, want true for an errored tool", f.IsError)
	}
	// The error message IS the output — that is what the card renders.
	if f.Output == nil || *f.Output != "exit status 1" {
		t.Errorf("output = %v, want the error message %q", f.Output, "exit status 1")
	}
}

// opencode re-publishes a tool part on every transition, and can repeat one.
// Exactly one start and one end must reach the consumer regardless.
func TestToolCallTracker_DeDupesResentParts(t *testing.T) {
	tracker := newToolCallTracker()
	running := toolEvent("s1", "call_1", "read", `{"status":"running","input":{"path":"a.go"}}`)
	completed := toolEvent("s1", "call_1", "read", `{"status":"completed","input":{"path":"a.go"},"output":"contents"}`)

	var all []toolFrame
	for _, payload := range []string{
		toolEvent("s1", "call_1", "read", `{"status":"pending"}`),
		running, running, // opencode re-sent the same running state
		completed, completed, // and the same completed state
	} {
		all = append(all, emitFrames(t, tracker, payload)...)
	}

	if len(all) != 2 {
		t.Fatalf("expected exactly 2 frames (one start, one end) across re-sent parts, got %d: %+v", len(all), all)
	}
	if all[0].Phase != "start" || all[1].Phase != "end" {
		t.Errorf("expected start then end, got %q then %q", all[0].Phase, all[1].Phase)
	}
	if all[0].ID != all[1].ID {
		t.Errorf("start id %q and end id %q must match so the consumer can pair them", all[0].ID, all[1].ID)
	}
}

// A fast tool can settle without ever surfacing a `running`. The consumer must
// still never be asked to close a card it was never told to open.
func TestToolCallTracker_SettleWithoutRunningStillEmitsStartFirst(t *testing.T) {
	tracker := newToolCallTracker()
	frames := emitFrames(t, tracker, toolEvent("s1", "call_9", "glob",
		`{"status":"completed","input":{"pattern":"*.go"},"output":"main.go"}`))

	if len(frames) != 2 {
		t.Fatalf("expected a synthesized start + the end, got %d: %+v", len(frames), frames)
	}
	if frames[0].Phase != "start" || frames[1].Phase != "end" {
		t.Fatalf("expected start then end, got %q then %q", frames[0].Phase, frames[1].Phase)
	}
	if string(frames[0].Input) != `{"pattern":"*.go"}` {
		t.Errorf("the synthesized start should still carry the input, got %s", frames[0].Input)
	}
}

// opencode types tool output loosely — a result can arrive structured. The frame
// contract says `output` is a STRING, so a JSON value is carried as its text.
func TestToolCallTracker_StructuredOutputIsStringified(t *testing.T) {
	tracker := newToolCallTracker()
	frames := emitFrames(t, tracker, toolEvent("s1", "call_3", "list_traces",
		`{"status":"completed","input":{},"output":{"count":2,"ids":["a","b"]}}`))

	end := frames[len(frames)-1]
	if end.Output == nil {
		t.Fatalf("expected an output on the end frame")
	}
	if *end.Output != `{"count":2,"ids":["a","b"]}` {
		t.Errorf("structured output should be carried as its JSON text, got %q", *end.Output)
	}
}

// A tool can return megabytes. The stream must not carry it — cap, mark, move on.
func TestToolCallTracker_CapsHugeOutput(t *testing.T) {
	tracker := newToolCallTracker()
	huge, err := json.Marshal(strings.Repeat("a", 5*maxToolOutputBytes))
	if err != nil {
		t.Fatalf("marshal huge output: %v", err)
	}
	frames := emitFrames(t, tracker, toolEvent("s1", "call_4", "read",
		fmt.Sprintf(`{"status":"completed","input":{},"output":%s}`, huge)))

	end := frames[len(frames)-1]
	if end.Output == nil {
		t.Fatalf("expected an output on the end frame")
	}
	got := *end.Output
	if len(got) > maxToolOutputBytes+len("…") {
		t.Errorf("output was not capped: %d bytes, cap is %d", len(got), maxToolOutputBytes)
	}
	if !strings.HasSuffix(got, "…") {
		t.Errorf("a truncated output must be marked with a trailing ellipsis, got %q", got[len(got)-8:])
	}
	if !utf8.ValidString(got) {
		t.Errorf("truncation must cut on a rune boundary so the output stays valid UTF-8")
	}
}

// Stream B and the tool lifecycle are disjoint: a text delta is not a tool call,
// and a tool part is not a token.
func TestToolCallTracker_IgnoresNonToolEvents(t *testing.T) {
	tracker := newToolCallTracker()
	for _, payload := range []string{
		`{"type":"message.part.delta","properties":{"sessionID":"s1","field":"text","delta":"Hel"}}`,
		`{"type":"message.part.updated","properties":{"sessionID":"s1","part":{"id":"prt_1","type":"text","text":"hi"}}}`,
		`{"type":"message.completed","sessionID":"s1"}`,
	} {
		if frames := emitFrames(t, tracker, payload); len(frames) != 0 {
			t.Errorf("expected no tool frame for %s, got %+v", payload, frames)
		}
	}
}

func TestTextDeltaFromEvent_ToolPartIsNotAToken(t *testing.T) {
	ev := decodeSSE(t, toolEvent("s1", "call_1", "read", `{"status":"running","input":{"path":"a.go"}}`))
	if got, ok := textDeltaFromEvent(ev); ok {
		t.Errorf("a tool part must not produce a Stream B token frame, got %q", got)
	}
}

// The tool lifecycle rides alongside the text deltas as compact start/end frames,
// all session-filtered so a sibling's tool call never leaks. The verbatim opencode
// events are NO LONGER emitted — the relay speaks only the frames union.
func TestStreamSession_EmitsToolFramesAlongsideDeltas(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/event" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		fl, _ := w.(http.Flusher)
		emit := func(s string) {
			fmt.Fprintf(w, "data: %s\n", s)
			if fl != nil {
				fl.Flush()
			}
		}
		emit(toolEvent("mine", "call_1", "search_traces", `{"status":"pending"}`))
		emit(toolEvent("mine", "call_1", "search_traces", `{"status":"running","title":"Searching","input":{"query":"errors"}}`))
		emit(`{"type":"message.part.delta","properties":{"sessionID":"mine","field":"text","delta":"Found"}}`)
		emit(toolEvent("sibling", "call_x", "bash", `{"status":"running","input":{"command":"leak"}}`))
		emit(toolEvent("mine", "call_1", "search_traces", `{"status":"completed","input":{"query":"errors"},"output":"3 traces"}`))
		emit(`{"type":"message.completed","sessionID":"mine"}`)
	}))
	defer srv.Close()

	got := collectFrames(t, srv.URL, "mine")

	var deltas int
	var toolFrames []toolFrame
	for _, line := range got {
		if strings.Contains(line, "leak") {
			t.Errorf("a sibling session's tool call must NOT be emitted, got %q", line)
		}
		switch frameType(t, line) {
		case "delta":
			deltas++
		case "tool":
			var f toolFrame
			if err := json.Unmarshal([]byte(line), &f); err != nil {
				t.Fatalf("decode tool frame %q: %v", line, err)
			}
			toolFrames = append(toolFrames, f)
		}
	}

	if deltas != 1 {
		t.Errorf("expected exactly 1 delta frame for the single text delta, got %d", deltas)
	}

	if len(toolFrames) != 2 {
		t.Fatalf("expected exactly one start + one end tool frame, got %d: %+v", len(toolFrames), toolFrames)
	}
	start, end := toolFrames[0], toolFrames[1]
	if start.Phase != "start" || end.Phase != "end" {
		t.Fatalf("expected start then end, got %q then %q", start.Phase, end.Phase)
	}
	if start.ID != "call_1" || end.ID != "call_1" {
		t.Errorf("start/end must share the callID so the consumer can pair them, got %q/%q", start.ID, end.ID)
	}
	if start.Name != "search_traces" || end.Name != "search_traces" {
		t.Errorf("both frames must name the tool, got %q/%q", start.Name, end.Name)
	}
	if string(start.Input) != `{"query":"errors"}` {
		t.Errorf("the start must carry the tool args, got %s", start.Input)
	}
	if end.Output == nil || *end.Output != "3 traces" {
		t.Errorf("the end must carry the result, got %v", end.Output)
	}
	if end.IsError == nil || *end.IsError {
		t.Errorf("a completed tool must settle with isError=false on the wire, got %v", end.IsError)
	}
}

// A transport failure on the internal probe (opencode's listener not up yet, a
// reset) must be classified as retryable — not a security verdict — so
// WaitForReadiness keeps polling instead of aborting the spawn.
func TestRequireOpenCodeAuthEnforced_TransportErrorIsRetryable(t *testing.T) {
	port, err := GetFreePort() // nothing listening here
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	err = requireOpenCodeAuthEnforced(context.Background(), port)
	if err == nil {
		t.Fatalf("expected an error probing a port with no listener")
	}
	if !errors.Is(err, errAuthProbeUnreachable) {
		t.Fatalf("transport failure must be classified retryable (errAuthProbeUnreachable), got %v", err)
	}
}

// truncateToolOutput must NEVER hand downstream half a JSON document. A CLI
// result over the cap is reduced structurally (arrays capped, long strings
// clipped) and stays parseable — the exact property whose absence rendered
// every oversized `langwatch trace search` as an unreadable card.
func TestTruncateToolOutput_ReducesJSONStructurally(t *testing.T) {
	traces := make([]map[string]any, 40)
	long := strings.Repeat("x", 2_000)
	for i := range traces {
		traces[i] = map[string]any{
			"trace_id": fmt.Sprintf("trace_%02d", i),
			"input":    map[string]any{"value": long},
			"output":   map[string]any{"value": long},
		}
	}
	doc, err := json.Marshal(map[string]any{
		"traces":     traces,
		"pagination": map[string]any{"totalHits": 40},
	})
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if len(doc) <= maxToolOutputBytes {
		t.Fatalf("fixture must exceed the cap, got %d bytes", len(doc))
	}

	out := truncateToolOutput(string(doc))

	if len(out) > maxToolOutputBytes {
		t.Fatalf("reduced output = %d bytes, want <= %d", len(out), maxToolOutputBytes)
	}
	var parsed struct {
		Traces     []any `json:"traces"`
		Pagination struct {
			TotalHits int `json:"totalHits"`
		} `json:"pagination"`
	}
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("reduced output must stay valid JSON, got %v\n%s", err, out)
	}
	if parsed.Pagination.TotalHits != 40 {
		t.Errorf("scalar fields must survive the reduction, totalHits = %d", parsed.Pagination.TotalHits)
	}
	if len(parsed.Traces) < 2 {
		t.Errorf("a sample of the array must survive, got %d items", len(parsed.Traces))
	}
	// The clip marker rides IN the array, shape intact.
	last, _ := parsed.Traces[len(parsed.Traces)-1].(string)
	if !strings.Contains(last, "more items truncated") {
		t.Errorf("clipped array must carry the in-band marker, tail = %v", parsed.Traces[len(parsed.Traces)-1])
	}
}

func TestTruncateToolOutput_SmallAndNonJSON(t *testing.T) {
	if got := truncateToolOutput("short"); got != "short" {
		t.Errorf("under-cap output must pass through, got %q", got)
	}

	big := strings.Repeat("plain text log line\n", 1_000)
	out := truncateToolOutput(big)
	if len(out) > maxToolOutputBytes+len("…") {
		t.Errorf("non-JSON falls back to the byte cut, got %d bytes", len(out))
	}
	if !strings.HasSuffix(out, "…") {
		t.Errorf("byte cut must be marked, tail = %q", out[len(out)-8:])
	}
}

func TestTruncateToolOutput_JSONBehindSpinnerNoise(t *testing.T) {
	// The langwatch CLI prints spinner noise before its JSON document; the
	// reducer must find and preserve the document anyway.
	long := strings.Repeat("y", 3_000)
	doc, _ := json.Marshal(map[string]any{
		"traces":     []any{map[string]any{"trace_id": "tr_1", "input": long}},
		"pagination": map[string]any{"totalHits": 12},
	})
	noisy := "- Searching traces...\n✔ Found 12 traces (showing 12)\n" + string(doc) + strings.Repeat(" ", 9_000)

	out := truncateToolOutput(noisy)

	var parsed map[string]any
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("document behind noise must survive as valid JSON: %v\n%s", err, out)
	}
	if _, ok := parsed["pagination"]; !ok {
		t.Errorf("document fields must survive, got keys %v", parsed)
	}
}

// Text resuming after a tool call is a NEW segment of the answer: the deltas
// carry no part boundary, so the stream restores the paragraph — without it the
// pre-tool preamble and the post-tool answer concatenate into one sentence
// ("…for those traces.No traces failing…") everywhere downstream.
func TestStreamSession_TextAfterToolStartsANewParagraph(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/event" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		fl, _ := w.(http.Flusher)
		emit := func(s string) {
			fmt.Fprintf(w, "data: %s\n", s)
			if fl != nil {
				fl.Flush()
			}
		}
		emit(`{"type":"message.part.delta","properties":{"sessionID":"mine","field":"text","delta":"I'll check the traces."}}`)
		emit(toolEvent("mine", "call_1", "bash", `{"status":"running","input":{"command":"langwatch trace search"}}`))
		emit(toolEvent("mine", "call_1", "bash", `{"status":"completed","input":{"command":"langwatch trace search"},"output":"{}"}`))
		emit(`{"type":"message.part.delta","properties":{"sessionID":"mine","field":"text","delta":"No traces matched."}}`)
		emit(`{"type":"message.completed","sessionID":"mine"}`)
	}))
	defer srv.Close()

	got := collectFrames(t, srv.URL, "mine")

	var deltaTexts []string
	for _, line := range got {
		if frameType(t, line) != "delta" {
			continue
		}
		var f struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(line), &f); err != nil {
			t.Fatalf("decode delta frame %q: %v", line, err)
		}
		deltaTexts = append(deltaTexts, f.Text)
	}

	if len(deltaTexts) != 2 {
		t.Fatalf("expected 2 delta frames, got %d: %v", len(deltaTexts), deltaTexts)
	}
	if deltaTexts[0] != "I'll check the traces." {
		t.Errorf("the first segment must be untouched, got %q", deltaTexts[0])
	}
	if deltaTexts[1] != "\n\nNo traces matched." {
		t.Errorf("text after a tool call must open a new paragraph, got %q", deltaTexts[1])
	}
}

// planFrame is the decoded plan snapshot the manager mirrors from a settled
// todowrite tool part.
type planFrameT struct {
	Type  string `json:"type"`
	Items []struct {
		Content string `json:"content"`
		Status  string `json:"status"`
	} `json:"items"`
}

// framesByType splits a tracker's emitted frames into decoded tool frames and
// the plan frames that ride alongside them.
func framesByType(t *testing.T, tracker *toolCallTracker, payload string) (tools []toolFrame, plans []planFrameT) {
	t.Helper()
	for _, f := range tracker.framesFor(decodeSSE(t, payload)) {
		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal([]byte(f.JSON()), &probe); err != nil {
			t.Fatalf("decode frame type %s: %v", f.JSON(), err)
		}
		switch probe.Type {
		case "plan":
			var p planFrameT
			if err := json.Unmarshal([]byte(f.JSON()), &p); err != nil {
				t.Fatalf("decode plan frame %s: %v", f.JSON(), err)
			}
			plans = append(plans, p)
		case "tool":
			var tf toolFrame
			if err := json.Unmarshal([]byte(f.JSON()), &tf); err != nil {
				t.Fatalf("decode tool frame %s: %v", f.JSON(), err)
			}
			tools = append(tools, tf)
		}
	}
	return tools, plans
}

// A settled todowrite mirrors as a typed plan snapshot AND keeps its tool frame
// for the durable audit trail.
func TestToolCallTracker_TodoWriteEmitsPlanAlongsideToolFrame(t *testing.T) {
	tracker := newToolCallTracker()
	input := `{"todos":[{"content":"Find the slow traces","status":"completed"},{"content":"Summarise them","status":"in_progress"},{"content":"Open a fix","status":"pending"}]}`
	tools, plans := framesByType(t, tracker, toolEvent("s1", "call_1", "todowrite",
		fmt.Sprintf(`{"status":"completed","input":%s,"output":"ok"}`, input)))

	// The tool frames (start withheld then start+end at settle) still ride the wire.
	if len(tools) == 0 {
		t.Fatalf("the todowrite tool frames must still be emitted for the audit trail")
	}
	if len(plans) != 1 {
		t.Fatalf("expected exactly 1 plan frame, got %d", len(plans))
	}
	p := plans[0]
	if len(p.Items) != 3 {
		t.Fatalf("plan must carry all 3 items, got %d", len(p.Items))
	}
	if p.Items[0].Content != "Find the slow traces" || p.Items[0].Status != "completed" {
		t.Errorf("first item = %+v, want the completed first step", p.Items[0])
	}
	if p.Items[1].Status != "in_progress" {
		t.Errorf("second item status = %q, want in_progress", p.Items[1].Status)
	}
}

// A counted X/Y todo becomes a measured progress frame. The duration comes from
// the actual preceding tool lifecycle, not from model-authored prose, so the
// client receives an honest first-batch rate sample.
func TestToolCallTracker_TodoWriteEmitsMeasuredBatchProgress(t *testing.T) {
	now := time.Unix(100, 0)
	tracker := newToolCallTrackerWithClock(func() time.Time { return now })

	tracker.framesFor(decodeSSE(t, toolEvent("s1", "fetch_1", "bash",
		`{"status":"running","input":{"command":"fetch batch"}}`)))
	now = now.Add(1250 * time.Millisecond)
	tracker.framesFor(decodeSSE(t, toolEvent("s1", "fetch_1", "bash",
		`{"status":"completed","input":{"command":"fetch batch"},"output":"ok"}`)))

	input := `{"todos":[{"content":"Analysing traces — 25/100","status":"in_progress"}]}`
	produced := tracker.framesFor(decodeSSE(t, toolEvent("s1", "progress_1", "todowrite",
		fmt.Sprintf(`{"status":"completed","input":%s,"output":"ok"}`, input))))

	var got struct {
		Type            string  `json:"type"`
		Message         string  `json:"message"`
		Progress        float64 `json:"progress"`
		Current         int64   `json:"current"`
		Total           int64   `json:"total"`
		BatchItems      int64   `json:"batchItems"`
		BatchDurationMs int64   `json:"batchDurationMs"`
	}
	found := false
	for _, frame := range produced {
		if err := json.Unmarshal([]byte(frame.JSON()), &got); err != nil {
			t.Fatal(err)
		}
		if got.Type == "progress" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected a progress frame, got %v", produced)
	}
	if got.Message != "Analysing traces — 25/100" || got.Progress != 0.25 ||
		got.Current != 25 || got.Total != 100 || got.BatchItems != 25 || got.BatchDurationMs != 1250 {
		t.Fatalf("unexpected measured progress: %+v", got)
	}
}

// A running todowrite (not yet settled) emits no plan — the snapshot is taken at
// settle, so the panel never mirrors a half-written list.
func TestToolCallTracker_TodoWriteEmitsNoPlanUntilSettled(t *testing.T) {
	tracker := newToolCallTracker()
	_, plans := framesByType(t, tracker, toolEvent("s1", "call_1", "todowrite",
		`{"status":"running","input":{"todos":[{"content":"Step one","status":"in_progress"}]}}`))
	if len(plans) != 0 {
		t.Fatalf("a running todowrite must emit no plan, got %d", len(plans))
	}
}

// A malformed / empty todowrite settles as a tool frame but mirrors no plan.
func TestToolCallTracker_TodoWriteMalformedEmitsNoPlan(t *testing.T) {
	tracker := newToolCallTracker()
	_, plans := framesByType(t, tracker, toolEvent("s1", "call_1", "todowrite",
		`{"status":"completed","input":{"todos":[]},"output":"ok"}`))
	if len(plans) != 0 {
		t.Fatalf("an empty todo list must emit no plan, got %d", len(plans))
	}
}

// The plan is capped at 30 items and each item's text truncated, never dropped.
func TestPlanItemsFromInput_CapsAndTruncates(t *testing.T) {
	var sb strings.Builder
	sb.WriteString(`{"todos":[`)
	for i := 0; i < 40; i++ {
		if i > 0 {
			sb.WriteString(",")
		}
		sb.WriteString(fmt.Sprintf(`{"content":"%s","status":"pending"}`, strings.Repeat("x", 300)))
	}
	sb.WriteString(`]}`)

	items, ok := planItemsFromInput(json.RawMessage(sb.String()))
	if !ok {
		t.Fatalf("expected a plan from 40 items")
	}
	if len(items) != maxPlanItems {
		t.Fatalf("item count = %d, want it capped at %d", len(items), maxPlanItems)
	}
	if r := []rune(items[0].Content); len(r) != maxPlanContentChars+1 {
		t.Errorf("content len = %d runes, want %d capped + 1 ellipsis", len(r), maxPlanContentChars)
	}
}

// The bare-array shape is accepted too, not only { todos: [...] }.
func TestPlanItemsFromInput_AcceptsBareArray(t *testing.T) {
	items, ok := planItemsFromInput(json.RawMessage(`[{"content":"Only step","status":"in_progress"}]`))
	if !ok || len(items) != 1 || items[0].Content != "Only step" {
		t.Fatalf("bare array must parse, got ok=%v items=%+v", ok, items)
	}
}

// A failed LangWatch CLI command writes its failure DOCUMENT to stdout and a
// one-line human summary to stderr. Overwriting stdout with the summary threw
// away the code, the meta and the platform's own next steps at the first hop,
// and the panel showed "This step couldn't be completed" for a failure the
// platform had explained in full.
func TestToolEndFrame_KeepsTheCLIFailureDocumentOverTheSummaryLine(t *testing.T) {
	document := `{"ok":false,"error":{"code":"api_key_permission_denied","message":"denied","httpStatus":403,"meta":{"permission":"scenarios:create"},"isHandled":true}}`
	part := &ssePart{
		Tool: "bash",
		State: sseToolState{
			Output: json.RawMessage(strconv.Quote(document)),
			Error:  json.RawMessage(strconv.Quote("Failed to create scenario: denied")),
		},
	}

	frame, ok := toolEndFrame("call-1", part, true)
	if !ok {
		t.Fatal("expected a frame")
	}
	var decoded struct {
		Output string `json:"output"`
	}
	if err := json.Unmarshal([]byte(frame.JSON()), &decoded); err != nil {
		t.Fatalf("decode frame: %v", err)
	}
	if !strings.Contains(decoded.Output, "api_key_permission_denied") {
		t.Fatalf("failure document was dropped, got %q", decoded.Output)
	}
}

func TestToolEndFrame_UsesTheErrorMessageWhenStdoutHasNoDocument(t *testing.T) {
	part := &ssePart{
		Tool: "bash",
		State: sseToolState{
			Output: json.RawMessage(strconv.Quote("partial console output")),
			Error:  json.RawMessage(strconv.Quote("command not found: langwatch")),
		},
	}

	frame, ok := toolEndFrame("call-2", part, true)
	if !ok {
		t.Fatal("expected a frame")
	}
	var decoded struct {
		Output string `json:"output"`
	}
	if err := json.Unmarshal([]byte(frame.JSON()), &decoded); err != nil {
		t.Fatalf("decode frame: %v", err)
	}
	if decoded.Output != "command not found: langwatch" {
		t.Fatalf("expected the error message, got %q", decoded.Output)
	}
}

func TestCarriesFailureDocument(t *testing.T) {
	for _, tc := range []struct {
		name   string
		output string
		want   bool
	}{
		{"a failure document", `{"ok":false,"error":{"code":"not_found"}}`, true},
		{"a failure document after console noise", "- Creating...\n" + `{"ok":false,"error":{"code":"not_found"}}`, true},
		{"a successful result", `{"id":"scenario_1"}`, false},
		{"an ok-true document", `{"ok":true}`, false},
		{"a document with no error", `{"ok":false}`, false},
		{"a human table", "ID   NAME\n1    Support", false},
		{"empty output", "", false},
		{"truncated JSON", `{"ok":false,"error":{"code":"not_`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := carriesFailureDocument(tc.output); got != tc.want {
				t.Fatalf("carriesFailureDocument(%q) = %v, want %v", tc.output, got, tc.want)
			}
		})
	}
}

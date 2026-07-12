package frames

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/internal/frameauth"
)

// The frame JSON shapes must match the TS langyRelayFrame zod union exactly (the
// relay parses the payload against it). These pin the marshalled shape per
// constructor, and prove a produced frame signs + verifies through frameauth.

// mk unwraps a constructor's (Frame, error) — usable as `mk(Delta("hi"))`
// because the multi-value call is the sole argument.
func mk(f Frame, err error) Frame {
	if err != nil {
		panic(err)
	}
	return f
}

func asMap(t *testing.T, f Frame) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(f.JSON()), &m); err != nil {
		t.Fatalf("payload not valid JSON: %v (%s)", err, f.JSON())
	}
	return m
}

func TestFrameShapes(t *testing.T) {
	prog := 0.5
	cases := []struct {
		name string
		got  Frame
		want map[string]any
	}{
		{"delta", mk(Delta("hi")), map[string]any{"type": "delta", "text": "hi"}},
		{"status", mk(Status("running bash")), map[string]any{"type": "status", "status": "running bash"}},
		{"heartbeat", mk(Heartbeat()), map[string]any{"type": "heartbeat"}},
		{"progress-empty", mk(Progress("", nil)), map[string]any{"type": "progress"}},
		{"progress-full", mk(Progress("step 1", &prog)), map[string]any{"type": "progress", "message": "step 1", "progress": 0.5}},
		{"card", mk(Card("trace_download", "trace-9", nil)), map[string]any{"type": "card", "kind": "trace_download", "detail": "trace-9"}},
		{"tool-start", mk(ToolStart("tc-1", "bash", "Run bash", "ls", nil)), map[string]any{"type": "tool", "id": "tc-1", "name": "bash", "phase": "start", "title": "Run bash", "command": "ls"}},
		{"error", mk(Error("Langy is unavailable", "at-capacity")), map[string]any{"type": "error", "error": "Langy is unavailable", "code": "at-capacity"}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			got := asMap(t, c.got)
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("shape mismatch:\n got  %v\n want %v", got, c.want)
			}
		})
	}
}

func TestToolEnd_ErrorCarriesFlagAndOutput(t *testing.T) {
	m := asMap(t, mk(ToolEnd("tc-1", "bash", true, "boom", 12)))
	if m["type"] != "tool" || m["phase"] != "end" || m["isError"] != true || m["output"] != "boom" {
		t.Fatalf("unexpected tool-end shape: %v", m)
	}
	// A successful tool end omits isError entirely (treated as not-error).
	ok := asMap(t, mk(ToolEnd("tc-2", "bash", false, "done", 0)))
	if _, present := ok["isError"]; present {
		t.Fatalf("successful tool end must omit isError: %v", ok)
	}
}

func TestFinal_CarriesTextAndToolCalls(t *testing.T) {
	out := "result"
	f, err := Final("the answer", []ToolCall{{ID: "t", Name: "bash", Output: &out}})
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Type      string `json:"type"`
		Text      string `json:"text"`
		ToolCalls []struct {
			ID     string `json:"id"`
			Output string `json:"output"`
		} `json:"toolCalls"`
	}
	if err := json.Unmarshal([]byte(f.JSON()), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Type != "final" || parsed.Text != "the answer" || len(parsed.ToolCalls) != 1 ||
		parsed.ToolCalls[0].ID != "t" || parsed.ToolCalls[0].Output != "result" {
		t.Fatalf("unexpected final shape: %+v", parsed)
	}
}

func TestSign_RoundTripsThroughFrameauth(t *testing.T) {
	runToken, err := frameauth.MintRunToken()
	if err != nil {
		t.Fatal(err)
	}
	id := frameauth.Identity{
		ProjectID:      "proj-1",
		UserID:         "user-1",
		ConversationID: "conv-1",
		TurnID:         "turn-1",
	}
	f, err := Delta("hello")
	if err != nil {
		t.Fatal(err)
	}
	env, err := f.Sign(runToken, id)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if env.Payload != f.JSON() {
		t.Fatalf("envelope payload must be the frame JSON verbatim:\n got  %s\n want %s", env.Payload, f.JSON())
	}
	if !frameauth.Verify(runToken, env) {
		t.Fatal("signed frame failed to verify")
	}
	// The identity rode into the envelope for the relay to bind against.
	if env.ConversationID != "conv-1" || env.TurnID != "turn-1" {
		t.Fatalf("identity not carried: %+v", env.Identity)
	}
}

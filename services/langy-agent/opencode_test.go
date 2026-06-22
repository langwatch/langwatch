package langyagent

import "testing"

func TestEventBelongsToSession_TopLevelKeys(t *testing.T) {
	// OpenCode has emitted the sessionID under three different keys across
	// versions. eventBelongsToSession must accept all three.
	cases := []map[string]any{
		{"sessionID": "s1"},
		{"sessionId": "s1"},
		{"session_id": "s1"},
	}
	for _, ev := range cases {
		if !eventBelongsToSession(ev, "s1") {
			t.Errorf("expected match for %#v", ev)
		}
		if eventBelongsToSession(ev, "other") {
			t.Errorf("expected mismatch with other id for %#v", ev)
		}
	}
}

func TestEventBelongsToSession_PropertiesNested(t *testing.T) {
	ev := map[string]any{
		"type":       "message.part.delta",
		"properties": map[string]any{"sessionID": "s2", "field": "text"},
	}
	if !eventBelongsToSession(ev, "s2") {
		t.Errorf("expected match via properties.sessionID")
	}
	if eventBelongsToSession(ev, "other") {
		t.Errorf("expected mismatch via properties.sessionID")
	}
}

func TestEventBelongsToSession_EmptyTargetRejects(t *testing.T) {
	// An empty sessionID must never match — otherwise events from a worker
	// whose session id we don't yet know would be forwarded blindly.
	ev := map[string]any{"sessionID": "s1"}
	if eventBelongsToSession(ev, "") {
		t.Errorf("expected empty sessionID to reject")
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

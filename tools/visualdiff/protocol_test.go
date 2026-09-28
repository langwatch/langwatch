package visualdiff

import (
	"encoding/json"
	"strings"
	"testing"
)

// @scenario A run captures the route list and the flow list on both refs
func TestParseRunnerStreamReadsCapturesAndDiffs(t *testing.T) {
	lines := strings.Join([]string{
		`{"type":"ready"}`,
		`{"type":"capture","kind":"route","key":"/settings","side":"base","screenshot":"/s/base.png","consoleErrors":[],"failedRequests":[]}`,
		`{"type":"capture","kind":"route","key":"/settings","side":"candidate","screenshot":"/s/candidate.png","consoleErrors":["boom"],"failedRequests":["404 GET /api/x"]}`,
		`{"type":"diff","kind":"route","key":"/settings","ratio":0.25,"file":"/s/diff.png"}`,
		`{"type":"done"}`,
	}, "\n")

	stream, err := ParseRunnerStream(strings.NewReader(lines))

	if err != nil {
		t.Fatal(err)
	}
	if len(stream.Captures) != 2 || stream.Captures[1].ConsoleErrors[0] != "boom" {
		t.Fatalf("captures: %+v", stream.Captures)
	}
	if len(stream.Diffs) != 1 || stream.Diffs[0].Ratio != 0.25 || stream.Diffs[0].Key != "/settings" {
		t.Fatalf("diffs: %+v", stream.Diffs)
	}
}

func TestParseRunnerStreamRefusesWhatItCannotRead(t *testing.T) {
	if _, err := ParseRunnerStream(strings.NewReader("{not json}")); err == nil {
		t.Fatal("a malformed line was skipped rather than reported")
	}
	if _, err := ParseRunnerStream(strings.NewReader(`{"type":"teleport"}`)); err == nil {
		t.Fatal("an unknown message type was ignored")
	}
	_, err := ParseRunnerStream(strings.NewReader(`{"type":"error","message":"chromium is not installed"}`))
	if err == nil || !strings.Contains(err.Error(), "chromium") {
		t.Fatalf("the runner's own error should surface: %v", err)
	}
}

func TestRunnerPlanSpellsSettleAndViewportAsTheRunnerReadsThem(t *testing.T) {
	encoded, err := json.Marshal(RunnerPlan{
		Viewport: Viewport{Width: 1440, Height: 900},
		Settle:   Settle{QuietMillis: 500, DeadlineMillis: 20000},
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{`"width":1440`, `"height":900`, `"quietMillis":500`, `"deadlineMillis":20000`} {
		if !strings.Contains(string(encoded), key) {
			t.Fatalf("plan lacks %s, so the runner reads undefined and never settles: %s", key, encoded)
		}
	}
}

func TestRunnerPlanSpellsFlowsAsTheRunnerReadsThem(t *testing.T) {
	encoded, err := json.Marshal(RunnerPlan{Flows: []Flow{{
		ID:    "open-trace",
		Title: "Open a trace",
		Steps: []Step{{Action: "click", Label: "row", Optional: true, With: map[string]string{"text": "x"}}},
	}}})
	if err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{`"id":"open-trace"`, `"title":"Open a trace"`, `"steps":[`, `"action":"click"`, `"label":"row"`, `"optional":true`, `"with":{`} {
		if !strings.Contains(string(encoded), key) {
			t.Fatalf("plan lacks %s, so the runner reads flow.steps as undefined and crashes: %s", key, encoded)
		}
	}
}

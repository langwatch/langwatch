package toolmap

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// TruncateToolOutput must NEVER hand downstream half a JSON document. A CLI
// result over the cap is reduced structurally (arrays capped, long strings
// clipped) and stays parseable, the exact property whose absence rendered
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
	if len(doc) <= MaxToolOutputBytes {
		t.Fatalf("fixture must exceed the cap, got %d bytes", len(doc))
	}

	out := TruncateToolOutput(string(doc))

	if len(out) > MaxToolOutputBytes {
		t.Fatalf("reduced output = %d bytes, want <= %d", len(out), MaxToolOutputBytes)
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
		// Fatal, not an error: the tail read below would panic on an empty array
		// and a panic diagnoses nothing.
		t.Fatalf("a sample of the array must survive, got %d items", len(parsed.Traces))
	}
	// The clip marker rides IN the array, shape intact, and states the true
	// total so a reader with no count field of its own still has one.
	last, _ := parsed.Traces[len(parsed.Traces)-1].(string)
	if !strings.Contains(last, "more items truncated") {
		t.Errorf("clipped array must carry the in-band marker, tail = %v", parsed.Traces[len(parsed.Traces)-1])
	}
	if !strings.Contains(last, "40 total") {
		t.Errorf("the marker must state the array's true size, tail = %q", last)
	}
}

func TestTruncateToolOutput_SmallAndNonJSON(t *testing.T) {
	if got := TruncateToolOutput("short"); got != "short" {
		t.Errorf("under-cap output must pass through, got %q", got)
	}

	big := strings.Repeat("plain text log line\n", 1_000)
	out := TruncateToolOutput(big)
	if len(out) > MaxToolOutputBytes+len("…") {
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

	out := TruncateToolOutput(noisy)

	var parsed map[string]any
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("document behind noise must survive as valid JSON: %v\n%s", err, out)
	}
	if _, ok := parsed["pagination"]; !ok {
		t.Errorf("document fields must survive, got keys %v", parsed)
	}
}

// The plan is capped at MaxPlanItems and each item's text truncated, never
// dropped.
func TestPlanItemsFromInput_CapsAndTruncates(t *testing.T) {
	var sb strings.Builder
	sb.WriteString(`{"todos":[`)
	for i := 0; i < 40; i++ {
		if i > 0 {
			sb.WriteString(",")
		}
		sb.WriteString(`{"content":"` + strings.Repeat("x", 300) + `","status":"pending"}`)
	}
	sb.WriteString(`]}`)

	items, ok := PlanItemsFromInput(json.RawMessage(sb.String()))
	if !ok {
		t.Fatalf("expected a plan from 40 items")
	}
	if len(items) != MaxPlanItems {
		t.Fatalf("item count = %d, want it capped at %d", len(items), MaxPlanItems)
	}
	if r := []rune(items[0].Content); len(r) != MaxPlanContentChars+1 {
		t.Errorf("content len = %d runes, want %d capped + 1 ellipsis", len(r), MaxPlanContentChars)
	}
}

// The bare-array shape is accepted too, not only { todos: [...] }.
func TestPlanItemsFromInput_AcceptsBareArray(t *testing.T) {
	items, ok := PlanItemsFromInput(json.RawMessage(`[{"content":"Only step","status":"in_progress"}]`))
	if !ok || len(items) != 1 || items[0].Content != "Only step" {
		t.Fatalf("bare array must parse, got ok=%v items=%+v", ok, items)
	}
}

func TestPlanItemsFromInput_EmptyAndMalformedYieldNothing(t *testing.T) {
	for _, raw := range []string{``, `null`, `{"todos":[]}`, `{"todos":[{"content":"  "}]}`, `"prose"`} {
		if items, ok := PlanItemsFromInput(json.RawMessage(raw)); ok {
			t.Errorf("PlanItemsFromInput(%q) = %+v, want no plan", raw, items)
		}
	}
}

// BoundPlanItems is the typed-input twin of PlanItemsFromInput, the pi
// adapter's wire plan events route through it directly.
func TestBoundPlanItems_AppliesTheSameBounds(t *testing.T) {
	items := make([]frames.PlanItem, 0, 40)
	for i := 0; i < 40; i++ {
		items = append(items, frames.PlanItem{Content: strings.Repeat("y", 300), Status: "pending"})
	}
	bounded, ok := BoundPlanItems(items)
	if !ok || len(bounded) != MaxPlanItems {
		t.Fatalf("bounded = %d items (ok=%v), want %d", len(bounded), ok, MaxPlanItems)
	}
	if r := []rune(bounded[0].Content); len(r) != MaxPlanContentChars+1 {
		t.Errorf("content len = %d runes, want %d capped + 1 ellipsis", len(r), MaxPlanContentChars)
	}
	if _, ok := BoundPlanItems([]frames.PlanItem{{Content: "  "}}); ok {
		t.Errorf("blank-only items must yield no plan")
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
			if got := CarriesFailureDocument(tc.output); got != tc.want {
				t.Fatalf("CarriesFailureDocument(%q) = %v, want %v", tc.output, got, tc.want)
			}
		})
	}
}

func TestHasToolInput(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want bool
	}{
		{``, false},
		{`null`, false},
		{`{}`, false},
		{`{"command":"ls"}`, true},
		{`"bare string"`, true},
		{`[1,2]`, true},
	} {
		if got := HasToolInput(json.RawMessage(tc.raw)); got != tc.want {
			t.Errorf("HasToolInput(%q) = %v, want %v", tc.raw, got, tc.want)
		}
	}
}

// The local tools and the two tools that talk to the person carry a title of
// ours, because pi sends none: without it the panel row reads "Local_bash"
// instead of saying the call runs on the developer's machine. Every other tool
// keeps the empty title and the card falls back to the tool name.
func TestToolTitle(t *testing.T) {
	for _, tc := range []struct {
		name string
		want string
	}{
		{"code_access", "Code access"},
		{"question", "Question"},
		{"local_read", "Read on your machine"},
		{"local_write", "Write on your machine"},
		{"local_edit", "Edit on your machine"},
		{"local_bash", "Run on your machine"},
		{"local_grep", "Search on your machine"},
		{"local_find", "Find on your machine"},
		{"local_ls", "List on your machine"},
		{"LOCAL_LS", "List on your machine"},
		{" local_ls ", "List on your machine"},
		{"bash", ""},
		{"todowrite", ""},
		{"", ""},
	} {
		if got := ToolTitle(tc.name); got != tc.want {
			t.Errorf("ToolTitle(%q) = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// The tracker guarantees exactly one start and one end per call id, and the
// settle of a non-plan call feeds the measured-progress batch timing.
func TestToolCallTracker_DeDupeAndMeasuredTiming(t *testing.T) {
	now := time.Unix(100, 0)
	tracker := NewToolCallTrackerWithClock(func() time.Time { return now })

	if !tracker.StartIfNew("call_1") {
		t.Fatalf("first StartIfNew must report true")
	}
	if tracker.StartIfNew("call_1") {
		t.Fatalf("a re-sent start must be a duplicate")
	}
	now = now.Add(1250 * time.Millisecond)
	if !tracker.EndIfNew("call_1", "bash") {
		t.Fatalf("first EndIfNew must report true")
	}
	if tracker.EndIfNew("call_1", "bash") {
		t.Fatalf("a re-sent end must be a duplicate")
	}

	frame, ok := tracker.MeasuredProgressFromPlan([]frames.PlanItem{
		{Content: "Analyzing traces — 25/100", Status: "in_progress"},
	})
	if !ok {
		t.Fatalf("expected a measured progress frame")
	}
	var got struct {
		Type            string `json:"type"`
		Current         int64  `json:"current"`
		Total           int64  `json:"total"`
		BatchItems      int64  `json:"batchItems"`
		BatchDurationMs int64  `json:"batchDurationMs"`
	}
	if err := json.Unmarshal([]byte(frame.JSON()), &got); err != nil {
		t.Fatal(err)
	}
	if got.Type != "progress" || got.Current != 25 || got.Total != 100 ||
		got.BatchItems != 25 || got.BatchDurationMs != 1250 {
		t.Fatalf("unexpected measured progress: %+v", got)
	}
}

// todowrite is bookkeeping, not work: its own settle must not contribute the
// batch timing a progress sample carries.
func TestToolCallTracker_PlanToolSettleContributesNoTiming(t *testing.T) {
	now := time.Unix(100, 0)
	tracker := NewToolCallTrackerWithClock(func() time.Time { return now })

	tracker.StartIfNew("plan_1")
	now = now.Add(5 * time.Second)
	tracker.EndIfNew("plan_1", "todowrite")

	frame, ok := tracker.MeasuredProgressFromPlan([]frames.PlanItem{
		{Content: "Scanning — 1/10", Status: "in_progress"},
	})
	if !ok {
		t.Fatalf("expected a measured progress frame")
	}
	if strings.Contains(frame.JSON(), "batchDurationMs") {
		t.Fatalf("todowrite settle timing leaked into the sample: %s", frame.JSON())
	}
}

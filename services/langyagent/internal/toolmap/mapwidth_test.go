package toolmap

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// A wide flat object must reduce like a long array does. Only arrays and
// strings were capped, so a result keyed by id (one object, thousands of keys)
// could not be brought under the budget by any tightening pass:
// reduceJSONOutput gave up and TruncateToolOutput severed the document with the
// byte cut, which is the unparseable card this whole path exists to prevent.
func TestTruncateToolOutput_CapsMapWidth(t *testing.T) {
	wide := make(map[string]any, 4_000)
	for i := range 4_000 {
		wide[fmt.Sprintf("trace_%05d", i)] = map[string]any{
			"status": "ok",
			"cost":   1.25,
		}
	}
	raw, err := json.Marshal(wide)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) <= MaxToolOutputBytes {
		t.Fatalf("fixture must exceed the cap to exercise reduction, got %d bytes", len(raw))
	}

	out := TruncateToolOutput(string(raw))
	if len(out) > MaxToolOutputBytes {
		t.Errorf("reduced output is %d bytes, over the %d cap", len(out), MaxToolOutputBytes)
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("a wide object was severed instead of reduced: %v\noutput head: %.200s", err, out)
	}
	if len(parsed) == 0 {
		t.Fatal("every key was dropped; the card has nothing to render")
	}
}

// Reduction must be deterministic. Go randomizes map iteration, so picking keys
// in range order would make the same document reduce to a different card on
// every call.
func TestTruncateToolOutput_MapReductionIsStable(t *testing.T) {
	wide := make(map[string]any, 3_000)
	for i := range 3_000 {
		wide[fmt.Sprintf("key_%05d", i)] = strings.Repeat("v", 40)
	}
	raw, err := json.Marshal(wide)
	if err != nil {
		t.Fatal(err)
	}
	first := TruncateToolOutput(string(raw))
	for range 5 {
		if got := TruncateToolOutput(string(raw)); got != first {
			t.Fatal("the same document reduced to a different card between calls")
		}
	}
}

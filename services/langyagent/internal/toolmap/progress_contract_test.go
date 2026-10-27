package toolmap

import (
	"regexp"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/internal/assets"
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// runningCountExample finds the backticked `label - current/total` spans the
// prompt teaches, which is the only shape the model is told to write.
var runningCountExample = regexp.MustCompile("`([^`]*[0-9][0-9,]*\\s*/\\s*[0-9][0-9,]*)`")

// The prompt teaches ONE example of the measured-progress line, and this parser
// is the only thing that reads it back, so the two are a single contract. An
// example the pattern rejects means the model dutifully writes progress that is
// never drawn, and nothing fails to say so: the todo line is simply carried as
// prose. A colon in place of the spaced dash was exactly that.
//
// @scenario "The documented progress example is the format the parser accepts"
func TestMeasuredProgress_DocumentedExampleParses(t *testing.T) {
	tmpl, err := assets.AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}

	examples := runningCountExample.FindAllStringSubmatch(tmpl, -1)
	if len(examples) == 0 {
		t.Fatal("the prompt no longer carries a running-count example, so nothing binds it to this parser")
	}

	for _, example := range examples {
		line := example[1]
		tracker := NewToolCallTracker()
		frame, ok := tracker.MeasuredProgressFromPlan([]frames.PlanItem{
			{Content: line, Status: "in_progress"},
		})
		if !ok {
			t.Errorf("the prompt teaches %q but the parser draws no progress for it", line)
			continue
		}
		if !strings.Contains(frame.JSON(), `"type":"progress"`) {
			t.Errorf("%q produced %s, want a progress frame", line, frame.JSON())
		}
	}
}

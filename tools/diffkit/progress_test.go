package diffkit

import (
	"strings"
	"testing"
	"time"
)

func TestProgressLineReadsRateAndTimeLeft(t *testing.T) {
	scenarios := Ticker{Label: "scenarios", Total: 1830}
	line := scenarios.line(progress{done: 412, detail: "398 pass 9 fail-branch 5 err", elapsed: 10 * time.Second})
	for _, want := range []string{"scenarios 412/1830", "398 pass 9 fail-branch 5 err", "41.2/s", "~34s left"} {
		if !strings.Contains(line, want) {
			t.Errorf("%q lacks %q", line, want)
		}
	}
	probe := Ticker{Label: "probe", Total: 5}
	if done := probe.line(progress{done: 5, elapsed: time.Second}); strings.Contains(done, "left") {
		t.Errorf("a finished pass reports time left: %q", done)
	}
}

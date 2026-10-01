package apidiff

import (
	"bytes"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestStampWriterStartsEveryLineWithTheClock(t *testing.T) {
	var out bytes.Buffer
	writer := &stampWriter{out: &out}
	_, _ = writer.Write([]byte("one\ntw"))
	_, _ = writer.Write([]byte("o\nthree"))
	writer.flush()
	stamp := regexp.MustCompile(`^\[\d\d:\d\d:\d\d\] (one|two|three)$`)
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 3 {
		t.Fatalf("lines: %q", lines)
	}
	for _, line := range lines {
		if !stamp.MatchString(line) {
			t.Errorf("line %q lacks the stamp", line)
		}
	}
}

func TestProgressLineReadsRateAndTimeLeft(t *testing.T) {
	line := progressLine("scenarios", 1830, 412, "398 pass 9 fail-branch 5 err", 10*time.Second)
	for _, want := range []string{"scenarios 412/1830", "398 pass 9 fail-branch 5 err", "41.2/s", "~34s left"} {
		if !strings.Contains(line, want) {
			t.Errorf("%q lacks %q", line, want)
		}
	}
	if done := progressLine("probe", 5, 5, "", time.Second); strings.Contains(done, "left") {
		t.Errorf("a finished pass reports time left: %q", done)
	}
}

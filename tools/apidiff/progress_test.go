package apidiff

import (
	"bytes"
	"regexp"
	"strings"
	"testing"
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

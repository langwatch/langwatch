package cmd

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

func TestPrintTraceIndentsByDepthAndLinksGrafana(t *testing.T) {
	var out bytes.Buffer
	spans := []sources.Span{{Name: "GET /", Service: "api", Duration: time.Second}, {Depth: 1, Name: "db", Service: "api"}}
	if err := printTrace(readOutput{w: &out, link: "http://g/x"}, spans); err != nil {
		t.Fatal(err)
	}
	got := out.String()
	if !strings.Contains(got, "\n  db  api") || !strings.HasSuffix(got, "grafana: http://g/x\n") {
		t.Errorf("tree = %q", got)
	}
}

func TestTraceFilterRefusesABadDuration(t *testing.T) {
	_, err := traceFilterFrom(invocation{flags: map[string]string{"--since": "soon"}})
	if err == nil {
		t.Fatal("want an error for --since soon")
	}
}

func TestGrepLogLinesKeepsMatchesOnly(t *testing.T) {
	lines := []logLine{{text: "all good"}, {text: "boom happened"}}
	if got := grepLogLines(lines, "boom"); len(got) != 1 || got[0].text != "boom happened" {
		t.Errorf("got %v", got)
	}
}

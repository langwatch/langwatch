package spandigest

import (
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/scenario/go/internal/jsstr"
)

// Scenarios "grep_trace shows the text around a match deep inside a long
// value" and "expand_trace pages through a long span" of
// specs/progressive-trace-discovery.feature in the scenario repository.
const longSpanNeedle = "The attendance record fell on its 21st anniversary."

func longRetrievalSpan() sdktrace.ReadOnlySpan {
	filler := "The regional council discussed road maintenance budgets. "
	repeat := func(n int) string { return strings.Repeat(filler, (n+len(filler)-1)/len(filler)) }
	documents := repeat(30_000) + longSpanNeedle + " " + repeat(10_000)
	sid := trace.SpanID{0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x18}
	return tracetest.SpanStub{
		Name:        "retrieve_documents",
		SpanContext: trace.NewSpanContext(trace.SpanContextConfig{TraceID: trace.TraceID{1}, SpanID: sid}),
		StartTime:   time.Unix(1_700_000_000, 0),
		EndTime:     time.Unix(1_700_000_000, 300_000_000),
		Attributes:  []attribute.KeyValue{attribute.String("retrieval.documents", documents)},
	}.Snapshot()
}

func TestGrepTraceReturnsWindowAroundDeepMatch(t *testing.T) {
	result := GrepTrace([]sdktrace.ReadOnlySpan{longRetrievalSpan()}, "21st anniversary")
	if !strings.Contains(result, longSpanNeedle) {
		t.Fatalf("needle missing from %q", result)
	}
	if !regexp.MustCompile(`\[match at character 3\d{4} of \d+\]`).MatchString(result) {
		t.Errorf("match position missing from %q", result)
	}
	if n := jsstr.Len(result); n >= 4_000 {
		t.Errorf("result is %d characters long", n)
	}
}

func TestExpandTracePagesThroughLongSpan(t *testing.T) {
	spans := []sdktrace.ReadOnlySpan{longRetrievalSpan()}
	next := regexp.MustCompile(`offset=(\d+)`)
	var pages []string
	offset := 0
	for range 10 {
		page := ExpandTrace(spans, []string{"a1b2c3d4"}, offset)
		pages = append(pages, page)
		m := next.FindStringSubmatch(page)
		if m == nil {
			break
		}
		offset, _ = strconv.Atoi(m[1])
	}
	if len(pages) < 2 {
		t.Fatalf("expected several pages, got %d", len(pages))
	}
	if strings.Contains(pages[0], longSpanNeedle) {
		t.Error("first page already holds the needle")
	}
	if !strings.Contains(pages[0], "do not conclude that something is absent") {
		t.Errorf("first page footer: %q", pages[0][len(pages[0])-400:])
	}
	found := false
	for _, p := range pages {
		found = found || strings.Contains(p, longSpanNeedle)
	}
	if !found {
		t.Error("no page reaches the needle")
	}
	if !regexp.MustCompile(`^\[Showing characters \d+-\d+ of \d+\]`).MatchString(pages[1]) {
		t.Errorf("second page header: %q", pages[1][:80])
	}
}

func TestExpandTraceOffsetPastTheEnd(t *testing.T) {
	page := ExpandTrace([]sdktrace.ReadOnlySpan{longRetrievalSpan()}, []string{"a1b2c3d4"}, 10_000_000)
	if !regexp.MustCompile(`^\[Showing characters \d+-\d+ of \d+\]`).MatchString(page) {
		t.Errorf("page %q", page)
	}
}

func TestGrepWindowsCountUTF16Units(t *testing.T) {
	// Astral characters count two UTF-16 units, as String#length does.
	line := strings.Repeat("😀", 500) + "needle" + strings.Repeat("x", 100)
	windows := matchWindows(line, newGrepMatcher("NEEDLE"))
	if len(windows) != 1 {
		t.Fatalf("windows %d", len(windows))
	}
	if !strings.HasSuffix(windows[0], " [match at character 1000 of 1106]") {
		t.Errorf("window %q", windows[0][len(windows[0])-60:])
	}
	if !strings.HasPrefix(windows[0], "..."+strings.Repeat("😀", 200)+"needle") {
		t.Errorf("window start %q", windows[0][:40])
	}
}

func TestGrepShortLineReturnedWhole(t *testing.T) {
	line := strings.Repeat("a", 790) + "needle"
	if got := matchWindows(line, newGrepMatcher("needle")); len(got) != 1 || got[0] != line {
		t.Errorf("got %v", got)
	}
}

func TestGrepWindowsCapAndSkipOverlaps(t *testing.T) {
	line := strings.Repeat(strings.Repeat("y", 1000)+"hit", 8)
	windows := matchWindows(line, newGrepMatcher("hit"))
	if len(windows) != 5 {
		t.Fatalf("windows %d", len(windows))
	}
	if !strings.HasSuffix(windows[0], "... [match at character 1000 of 8024]") {
		t.Errorf("window %q", windows[0][len(windows[0])-60:])
	}
	near := strings.Repeat("z", 1000) + "hit" + strings.Repeat("z", 10) + "hit" + strings.Repeat("z", 1000)
	if got := matchWindows(near, newGrepMatcher("hit")); len(got) != 1 {
		t.Errorf("overlapping match must be skipped, got %d windows", len(got))
	}
}

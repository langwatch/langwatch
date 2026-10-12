package spandigest

import (
	"bytes"
	"encoding/hex"
	"strconv"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/langwatch/scenario/go/internal/jsstr"
)

const (
	// DefaultTokenThreshold is the estimated digest size above which the judge
	// receives the structure-only view plus the discovery tools.
	DefaultTokenThreshold = 8192
	// toolResultCharBudget caps a single tool result (~4096 tokens).
	toolResultCharBudget = 4096 * 4
	maxGrepMatches       = 20
	// LargeTraceHint follows the structure-only digest.
	LargeTraceHint = "\n\nUse expand_trace(span_id) to see span details or grep_trace(pattern) to search across spans. Reference spans by the ID shown in brackets."
)

// EstimateTokens estimates the token count of text as ceil(UTF-8 bytes / 4).
func EstimateTokens(text string) int {
	return (len(text) + 3) / 4
}

// ExpandTrace returns the full details of the spans whose id starts with one
// of the given prefixes.
func ExpandTrace(spans []sdktrace.ReadOnlySpan, spanIDs []string) string {
	if len(spans) == 0 {
		return NoSpans
	}
	if len(spanIDs) == 0 {
		return "Error: provide at least one span ID."
	}
	sorted := SortByStartTime(spans)
	var out lines
	var attrs []cleanAttribute
	var c compiler
	matched := 0
	for _, s := range sorted {
		id := s.SpanContext().SpanID().String()
		hit := false
		for _, prefix := range spanIDs {
			if strings.HasPrefix(id, prefix) {
				hit = true
				break
			}
		}
		if !hit {
			continue
		}
		matched++
		attrs = renderFullSpan(&out, &c, s, attrs)
		out.add("")
	}
	if matched == 0 {
		var b strings.Builder
		b.WriteString("Error: no spans matched the given ID(s). Available span IDs: ")
		for i, s := range sorted {
			if i > 0 {
				b.WriteString(", ")
			}
			b.Write(AppendShortID(nil, s.SpanContext().SpanID()))
		}
		return b.String()
	}
	return truncateToCharBudget(string(bytes.TrimRight(out.buf, " \t\n\r")))
}

func renderFullSpan(out *lines, c *compiler, s sdktrace.ReadOnlySpan, attrs []cleanAttribute) []cleanAttribute {
	out.buf = appendHeader(out.start(), s, false)
	attrs = cleanAttributes(attrs, s.Attributes())
	for _, a := range attrs {
		out.buf = appendAttr(out.start(), c, "    ", a)
	}
	for _, ev := range s.Events() {
		out.add("    [event] " + ev.Name)
		attrs = cleanAttributes(attrs, ev.Attributes)
		for _, a := range attrs {
			out.buf = appendAttr(out.start(), c, "      ", a)
		}
	}
	return attrs
}

// appendAttr appends an indented "key: value" line, value as FormatValue.
func appendAttr(b []byte, c *compiler, indent string, a cleanAttribute) []byte {
	b = append(b, indent...)
	b = append(b, a.key...)
	b = append(b, ": "...)
	return appendFormattedValue(b, c, a.value)
}

// grepMatcher finds the lines of a span's searchable text (its name, then
// one "key: value" part per attribute and event) that contain a pattern,
// case-insensitively. Parts are assembled in a reused buffer, so only
// matching lines allocate.
type grepMatcher struct {
	needle []byte
	// ascii selects the allocation-free ASCII fold.
	ascii bool
	buf   []byte
	attrs []cleanAttribute
	comp  compiler
}

func newGrepMatcher(pattern string) *grepMatcher {
	m := &grepMatcher{ascii: isASCII(pattern)}
	if m.ascii {
		m.needle = []byte(pattern)
	} else {
		m.needle = []byte(strings.ToLower(pattern))
	}
	return m
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}

// containsFoldASCII reports whether s contains needle, folding ASCII case.
func containsFoldASCII(s, needle []byte) bool {
	n := len(needle)
	if n == 0 {
		return true
	}
	for i := 0; i+n <= len(s); i++ {
		j := 0
		for ; j < n; j++ {
			a, b := s[i+j], needle[j]
			if a != b && lowerASCII(a) != lowerASCII(b) {
				break
			}
		}
		if j == n {
			return true
		}
	}
	return false
}

func lowerASCII(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c + 'a' - 'A'
	}
	return c
}

func (m *grepMatcher) matches(line []byte) bool {
	if m.ascii {
		return containsFoldASCII(line, m.needle)
	}
	return bytes.Contains(bytes.ToLower(line), m.needle)
}

// part appends the matching lines of one part to hits, splitting on
// newlines the way strings.Split does.
func (m *grepMatcher) part(hits []string, part []byte) []string {
	for {
		i := bytes.IndexByte(part, '\n')
		line := part
		if i >= 0 {
			line = part[:i]
		}
		if m.matches(line) {
			hits = append(hits, string(line))
		}
		if i < 0 {
			return hits
		}
		part = part[i+1:]
	}
}

func (m *grepMatcher) attributeParts(hits []string, kvs []attribute.KeyValue) []string {
	m.attrs = cleanAttributes(m.attrs, kvs)
	for _, a := range m.attrs {
		m.buf = appendAttr(m.buf[:0], &m.comp, "", a)
		hits = m.part(hits, m.buf)
	}
	return hits
}

// span returns the matching lines of one span.
func (m *grepMatcher) span(s sdktrace.ReadOnlySpan) []string {
	var hits []string
	m.buf = append(m.buf[:0], s.Name()...)
	hits = m.part(hits, m.buf)
	hits = m.attributeParts(hits, s.Attributes())
	for _, ev := range s.Events() {
		m.buf = append(m.buf[:0], ev.Name...)
		hits = m.part(hits, m.buf)
		hits = m.attributeParts(hits, ev.Attributes)
	}
	return hits
}

// GrepTrace searches every span's name, attributes and events for pattern,
// case-insensitively, and lists the matching lines per span.
func GrepTrace(spans []sdktrace.ReadOnlySpan, pattern string) string {
	if len(spans) == 0 {
		return NoSpans
	}
	sorted := SortByStartTime(spans)
	type match struct {
		span  sdktrace.ReadOnlySpan
		lines []string
	}
	var matches []match
	matcher := newGrepMatcher(pattern)
	for _, s := range sorted {
		hits := matcher.span(s)
		if len(hits) > 0 {
			matches = append(matches, match{span: s, lines: hits})
		}
	}
	if len(matches) == 0 {
		var names []string
		seen := map[string]bool{}
		for _, s := range sorted {
			if !seen[s.Name()] {
				seen[s.Name()] = true
				names = append(names, s.Name())
			}
		}
		return `No matches found for "` + pattern + `". Available span names: ` + strings.Join(names, ", ")
	}
	var out lines
	for i, m := range matches {
		if i >= maxGrepMatches {
			break
		}
		b := out.start()
		b = append(b, "--- ["...)
		var id [8]byte
		sid := m.span.SpanContext().SpanID()
		hex.Encode(id[:], sid[:4])
		b = append(b, id[:]...)
		b = append(b, "] "...)
		b = append(b, m.span.Name()...)
		b = append(b, " ("...)
		b = appendDuration(b, SpanDurationMs(m.span))
		b = append(b, ") ---"...)
		out.buf = b
		for _, line := range m.lines {
			out.add("  " + line)
		}
		out.add("")
	}
	if len(matches) > maxGrepMatches {
		out.add("[" + strconv.Itoa(len(matches)-maxGrepMatches) + " more matches omitted. Refine your search pattern for more specific results.]")
	}
	return truncateToCharBudget(string(bytes.TrimRight(out.buf, " \t\n\r")))
}

func truncateToCharBudget(text string) string {
	if len(text) <= toolResultCharBudget || jsstr.Len(text) <= toolResultCharBudget {
		return text
	}
	return jsstr.Prefix(text, toolResultCharBudget) +
		"\n\n[TRUNCATED] Output exceeded ~4000 token budget. Use grep_trace(pattern) to search for specific content, or expand_trace with fewer span IDs."
}

package spandigest

import (
	"bytes"
	"encoding/hex"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

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
	// grepContextChars is the context kept on each side of a grep match.
	grepContextChars = 400
	// maxWindowsPerLine caps the windows shown per matching line.
	maxWindowsPerLine = 5
	// LargeTraceHint follows the structure-only digest.
	LargeTraceHint = "\n\nOnly the span structure is shown above, not the span contents. Before judging a criterion that depends on what a span holds, read it: grep_trace(pattern) finds text anywhere in the spans, even deep inside long values, and expand_trace(span_id) shows a span's details one page at a time. Content you have not read is missing evidence, never evidence that something is absent. Reference spans by the ID shown in brackets."
)

// EstimateTokens estimates the token count of text as ceil(UTF-8 bytes / 4).
func EstimateTokens(text string) int {
	return (len(text) + 3) / 4
}

// ExpandTrace returns the full details of the spans whose id starts with one
// of the given prefixes, one page of the result budget starting at offset
// UTF-16 code units.
func ExpandTrace(spans []sdktrace.ReadOnlySpan, spanIDs []string, offset int) string {
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
	return pageToCharBudget(string(bytes.TrimRight(out.buf, " \t\n\r")), offset)
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
// case-insensitively like a JavaScript /pattern/i regex. Parts are assembled
// in a reused buffer, so only matching lines allocate.
type grepMatcher struct {
	needle []byte
	// ascii selects the allocation-free ASCII fold.
	ascii bool
	// runes is the canonicalized pattern of the non-ASCII path.
	runes []rune
	buf   []byte
	attrs []cleanAttribute
	comp  compiler
}

func newGrepMatcher(pattern string) *grepMatcher {
	m := &grepMatcher{ascii: isASCII(pattern), needle: []byte(pattern)}
	if !m.ascii {
		for _, r := range pattern {
			m.runes = append(m.runes, canonicalize(r))
		}
	}
	return m
}

// canonicalize folds a character the way a non-unicode JavaScript /i regex
// does: to its uppercase form, unless that would map a non-ASCII character
// to an ASCII one. Astral characters are two code units there and never fold.
func canonicalize(r rune) rune {
	if r >= 0x10000 {
		return r
	}
	u := unicode.ToUpper(r)
	if r >= 0x80 && u < 0x80 {
		return r
	}
	return u
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}

func lowerASCII(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c + 'a' - 'A'
	}
	return c
}

// index returns the byte offset and byte length of the first match in s at
// or after from, or -1.
func (m *grepMatcher) index(s []byte, from int) (int, int) {
	if m.ascii {
		return m.indexASCII(s, from)
	}
	for i := from; i <= len(s); {
		if end, ok := m.runesAt(s, i); ok {
			return i, end - i
		}
		if i == len(s) {
			break
		}
		_, size := utf8.DecodeRune(s[i:])
		i += size
	}
	return -1, 0
}

func (m *grepMatcher) indexASCII(s []byte, from int) (int, int) {
	n := len(m.needle)
	for i := from; i+n <= len(s); i++ {
		if equalFoldASCII(s[i:i+n], m.needle) {
			return i, n
		}
	}
	return -1, 0
}

func equalFoldASCII(a, b []byte) bool {
	for j := range a {
		if a[j] != b[j] && lowerASCII(a[j]) != lowerASCII(b[j]) {
			return false
		}
	}
	return true
}

// runesAt reports whether the pattern matches s at byte offset i, and where
// the match ends.
func (m *grepMatcher) runesAt(s []byte, i int) (int, bool) {
	for _, want := range m.runes {
		if i >= len(s) {
			return 0, false
		}
		r, size := utf8.DecodeRune(s[i:])
		if canonicalize(r) != want {
			return 0, false
		}
		i += size
	}
	return i, true
}

func (m *grepMatcher) matches(line []byte) bool {
	i, _ := m.index(line, 0)
	return i >= 0
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
			for _, window := range matchWindows(line, matcher) {
				out.add("  " + window)
			}
		}
		out.add("")
	}
	if len(matches) > maxGrepMatches {
		out.add("[" + strconv.Itoa(len(matches)-maxGrepMatches) + " more matches omitted. Refine your search pattern for more specific results.]")
	}
	return truncateToCharBudget(string(bytes.TrimRight(out.buf, " \t\n\r")))
}

// pageToCharBudget returns one page of an expand_trace result starting at
// offset; the footer names the offset of the next page, so content past the
// budget stays reachable.
func pageToCharBudget(text string, offset int) string {
	total := jsstr.Len(text)
	start := max(0, min(offset, total))
	if start == 0 && total <= toolResultCharBudget {
		return text
	}
	end := min(start+toolResultCharBudget, total)
	header := ""
	if start > 0 {
		header = "[Showing characters " + strconv.Itoa(start) + "-" + strconv.Itoa(end) + " of " + strconv.Itoa(total) + "]\n"
	}
	footer := ""
	if end < total {
		footer = "\n\n[TRUNCATED] Showing characters " + strconv.Itoa(start) + "-" + strconv.Itoa(end) + " of " + strconv.Itoa(total) + ": " + strconv.Itoa(total-end) + " more characters of these spans are not shown, so do not conclude that something is absent from them. Call expand_trace with the same span IDs and offset=" + strconv.Itoa(end) + " to read on, or grep_trace(pattern) to jump to specific content."
	}
	return header + jsstr.Slice(text, start, end) + footer
}

// matchWindows returns the parts of a long line around each match, so a
// match deep inside one long attribute is shown instead of being cut off by
// the result budget. Positions count UTF-16 code units, as in the JS SDK.
func matchWindows(line string, m *grepMatcher) []string {
	total := jsstr.Len(line)
	if total <= grepContextChars*2 {
		return []string{line}
	}
	b := []byte(line)
	var windows []string
	lastEnd := -1
	// unitsAt is the UTF-16 offset of byte offset scanned.
	scanned, unitsAt := 0, 0
	for from := 0; from <= len(b) && len(windows) < maxWindowsPerLine; {
		i, n := m.index(b, from)
		if i < 0 {
			break
		}
		unitsAt += jsstr.Len(line[scanned:i])
		scanned = i
		at, size := unitsAt, jsstr.Len(line[i:i+n])
		if n == 0 {
			// An empty match advances one character, like String#matchAll.
			_, adv := utf8.DecodeRuneInString(line[i:])
			from = i + max(adv, 1)
		} else {
			from = i + n
		}
		if at < lastEnd {
			continue
		}
		start := max(0, at-grepContextChars)
		end := min(total, at+size+grepContextChars)
		var w strings.Builder
		if start > 0 {
			w.WriteString("...")
		}
		w.WriteString(jsstr.Slice(line, start, end))
		if end < total {
			w.WriteString("...")
		}
		w.WriteString(" [match at character " + strconv.Itoa(at) + " of " + strconv.Itoa(total) + "]")
		windows = append(windows, w.String())
		lastEnd = end
	}
	return windows
}

func truncateToCharBudget(text string) string {
	if len(text) <= toolResultCharBudget || jsstr.Len(text) <= toolResultCharBudget {
		return text
	}
	return jsstr.Prefix(text, toolResultCharBudget) +
		"\n\n[TRUNCATED] Output exceeded ~4000 token budget. Use grep_trace(pattern) to search for specific content, or expand_trace with fewer span IDs."
}

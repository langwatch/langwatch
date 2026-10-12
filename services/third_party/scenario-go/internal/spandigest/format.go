// Package spandigest renders OpenTelemetry spans as the plain-text digest the
// judge reads, and implements the expand_trace / grep_trace discovery tools.
// It ports the JS SDK's judge-span-digest-formatter, span-utils, trace-tools,
// string-deduplicator and truncate-media modules output for output.
package spandigest

import (
	"encoding/hex"
	"math"
	"math/big"
	"slices"
	"strconv"
	"time"
	"unsafe"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/scenario/go/internal/jsjson"
)

// NoSpans is the digest of an empty span list.
const NoSpans = "No spans recorded."

// DedupThreshold is the minimum length of a string the digest deduplicates.
const DedupThreshold = 50

type node struct {
	span     sdktrace.ReadOnlySpan
	children []*node
}

// lines accumulates newline-joined output.
type lines struct {
	buf   []byte
	count int
}

func (l *lines) start() []byte {
	if l.count > 0 {
		l.buf = append(l.buf, '\n')
	}
	l.count++
	return l.buf
}

func (l *lines) add(s string) {
	l.buf = append(l.start(), s...)
}

// Format renders every span with its attributes and events, deduplicating
// repeated long strings and truncating inline media.
func Format(spans []sdktrace.ReadOnlySpan) string {
	if len(spans) == 0 {
		return NoSpans
	}
	d := &deduplicator{threshold: DedupThreshold}
	r := renderer{dedup: d}
	return r.render(spans, false)
}

// FormatStructureOnly renders the span tree without attributes or events,
// with each span's token usage, for traces too large to inline.
func FormatStructureOnly(spans []sdktrace.ReadOnlySpan) string {
	if len(spans) == 0 {
		return NoSpans
	}
	r := renderer{}
	return r.render(spans, true)
}

type renderer struct {
	dedup *deduplicator
	out   lines
	attrs []cleanAttribute
}

func (r *renderer) render(spans []sdktrace.ReadOnlySpan, structureOnly bool) string {
	sorted := SortByStartTime(spans)
	roots := buildHierarchy(sorted)

	r.out.buf = make([]byte, 0, estimateSize(spans, structureOnly))
	b := r.out.start()
	b = append(b, "Spans: "...)
	b = strconv.AppendInt(b, int64(len(spans)), 10)
	b = append(b, " | Total Duration: "...)
	b = appendDuration(b, totalDurationMs(sorted))
	r.out.buf = b
	r.out.add("")

	for i, n := range roots {
		if structureOnly {
			r.renderStructure(n, 0, i == len(roots)-1)
		} else {
			r.renderFull(n, 0, i == len(roots)-1)
		}
	}
	r.renderErrors(spans)
	if len(r.out.buf) == 0 {
		return ""
	}
	// The buffer is never touched again, so it can back the string.
	return unsafe.String(&r.out.buf[0], len(r.out.buf))
}

// estimateSize guesses the digest size from the span names and attribute
// values, so the output buffer rarely grows.
func estimateSize(spans []sdktrace.ReadOnlySpan, structureOnly bool) int {
	n := 64
	for _, s := range spans {
		n += 96 + len(s.Name())
		if structureOnly {
			continue
		}
		for _, kv := range s.Attributes() {
			n += 16 + len(kv.Key)
			if kv.Value.Type() == attribute.STRING {
				n += len(kv.Value.AsString())
			} else {
				n += 16
			}
		}
	}
	return n
}

func (r *renderer) renderErrors(spans []sdktrace.ReadOnlySpan) {
	first := true
	for _, s := range spans {
		if s.Status().Code != codes.Error {
			continue
		}
		if first {
			r.out.add("")
			r.out.add("=== ERRORS ===")
			first = false
		}
		msg := s.Status().Description
		if msg == "" {
			msg = "unknown error"
		}
		b := r.out.start()
		b = append(b, "- "...)
		b = append(b, s.Name()...)
		b = append(b, ": "...)
		b = append(b, msg...)
		r.out.buf = b
	}
}

func (r *renderer) header(b []byte, n *node, prefix string, withTokens bool) []byte {
	s := n.span
	b = append(b, prefix...)
	b = append(b, '[')
	b = AppendShortID(b, s.SpanContext().SpanID())
	b = append(b, "] "...)
	b = appendISOTime(b, s.StartTime())
	b = append(b, ' ')
	b = append(b, s.Name()...)
	b = append(b, " ("...)
	b = appendDuration(b, SpanDurationMs(s))
	if withTokens {
		b = appendTokenUsage(b, s)
	}
	b = append(b, ')')
	return appendStatus(b, s)
}

func (r *renderer) renderStructure(n *node, depth int, isLast bool) {
	r.out.buf = r.header(r.out.start(), n, treePrefix(depth, isLast), true)
	r.out.add("")
	for i, c := range n.children {
		r.renderStructure(c, depth+1, i == len(n.children)-1)
	}
}

func (r *renderer) renderFull(n *node, depth int, isLast bool) {
	r.out.buf = r.header(r.out.start(), n, treePrefix(depth, isLast), false)
	indent := attrIndent(depth, isLast)
	r.attrs = cleanAttributes(r.attrs, n.span.Attributes())
	for _, a := range r.attrs {
		r.attrLine(indent, "", a)
	}
	for _, ev := range n.span.Events() {
		b := r.out.start()
		b = append(b, indent...)
		b = append(b, "[event] "...)
		b = append(b, ev.Name...)
		r.out.buf = b
		r.attrs = cleanAttributes(r.attrs, ev.Attributes)
		for _, a := range r.attrs {
			r.attrLine(indent, "  ", a)
		}
	}
	r.out.add("")
	for i, c := range n.children {
		r.renderFull(c, depth+1, i == len(n.children)-1)
	}
}

func (r *renderer) attrLine(indent, extra string, a cleanAttribute) {
	b := r.out.start()
	b = append(b, indent...)
	b = append(b, extra...)
	b = append(b, a.key...)
	b = append(b, ": "...)
	r.out.buf = r.dedup.appendValue(b, a.value)
}

// treePrefix returns the box-drawing connector of a node at depth.
func treePrefix(depth int, isLast bool) string {
	if depth == 0 {
		return ""
	}
	connector := "├── "
	if isLast {
		connector = "└── "
	}
	return repeatPipe(depth-1) + connector
}

func attrIndent(depth int, isLast bool) string {
	if depth == 0 {
		return "    "
	}
	continuation := "│   "
	if isLast {
		continuation = "    "
	}
	return repeatPipe(depth-1) + continuation + "    "
}

func repeatPipe(n int) string {
	if n == 0 {
		return ""
	}
	b := make([]byte, 0, n*len("│   "))
	for i := 0; i < n; i++ {
		b = append(b, "│   "...)
	}
	return string(b)
}

// SortByStartTime returns a copy of spans in stable start-time order.
func SortByStartTime(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan {
	sorted := slices.Clone(spans)
	slices.SortStableFunc(sorted, func(a, b sdktrace.ReadOnlySpan) int {
		return a.StartTime().Compare(b.StartTime())
	})
	return sorted
}

func buildHierarchy(sorted []sdktrace.ReadOnlySpan) []*node {
	nodes := make([]node, len(sorted))
	byID := make(map[trace.SpanID]*node, len(sorted))
	for i, s := range sorted {
		nodes[i].span = s
		byID[s.SpanContext().SpanID()] = &nodes[i]
	}
	roots := make([]*node, 0, 4)
	for i := range nodes {
		n := &nodes[i]
		parentID := n.span.Parent().SpanID()
		if parent, ok := byID[parentID]; ok && parentID.IsValid() && parent != n {
			parent.children = append(parent.children, n)
		} else {
			roots = append(roots, n)
		}
	}
	return roots
}

// AppendShortID appends the first 8 hex characters of a span id.
func AppendShortID(b []byte, id trace.SpanID) []byte {
	var buf [8]byte
	hex.Encode(buf[:], id[:4])
	return append(b, buf[:]...)
}

// hrMs mirrors the JS hrTimeToMs conversion of an OTel timestamp.
func hrMs(t time.Time) float64 {
	return float64(t.Unix())*1000 + float64(t.Nanosecond())/1_000_000
}

// SpanDurationMs is the span duration in milliseconds, computed like the JS
// SDK does from high-resolution timestamps.
func SpanDurationMs(s sdktrace.ReadOnlySpan) float64 {
	return hrMs(s.EndTime()) - hrMs(s.StartTime())
}

func totalDurationMs(sorted []sdktrace.ReadOnlySpan) float64 {
	first := hrMs(sorted[0].StartTime())
	last := math.Inf(-1)
	for _, s := range sorted {
		last = math.Max(last, hrMs(s.EndTime()))
	}
	return last - first
}

func appendISOTime(b []byte, t time.Time) []byte {
	ms := int64(math.Trunc(hrMs(t)))
	return time.UnixMilli(ms).UTC().AppendFormat(b, "2006-01-02T15:04:05.000Z")
}

// appendDuration formats milliseconds like the JS formatDuration: whole
// milliseconds under a second, otherwise seconds with two decimals.
func appendDuration(b []byte, ms float64) []byte {
	if ms < 1000 {
		b = jsjson.AppendNumber(b, jsRound(ms))
		return append(b, "ms"...)
	}
	b = appendToFixed2(b, ms/1000)
	return append(b, 's')
}

// AppendDuration is the exported form of appendDuration.
func AppendDuration(b []byte, ms float64) []byte { return appendDuration(b, ms) }

// jsRound is Math.round: halves round towards positive infinity.
func jsRound(x float64) float64 {
	r := math.Floor(x)
	if x-r >= 0.5 {
		r++
	}
	if r == 0 {
		return 0 // no negative zero
	}
	return r
}

// appendToFixed2 is Number#toFixed(2): the exact value is rounded half up,
// where Go's formatter rounds an exact tie to even.
func appendToFixed2(b []byte, x float64) []byte {
	if short := strconv.FormatFloat(x, 'f', -1, 64); isPossibleTie(short) {
		exact := new(big.Float).SetPrec(256).SetFloat64(x)
		exact.Mul(exact, big.NewFloat(1000))
		if exact.IsInt() {
			n, _ := exact.Int(nil)
			if new(big.Int).Rem(n, big.NewInt(10)).Int64() == 5 {
				hundredths := new(big.Int).Quo(n, big.NewInt(10))
				hundredths.Add(hundredths, big.NewInt(1))
				return appendHundredths(b, hundredths.Int64())
			}
		}
	}
	return strconv.AppendFloat(b, x, 'f', 2, 64)
}

// isPossibleTie reports whether the shortest representation has exactly
// three decimals ending in 5, the only way toFixed(2) can hit an exact tie.
func isPossibleTie(short string) bool {
	for i := 0; i < len(short); i++ {
		if short[i] == '.' {
			return len(short)-i-1 == 3 && short[len(short)-1] == '5'
		}
	}
	return false
}

func appendHundredths(b []byte, n int64) []byte {
	if n < 0 {
		b = append(b, '-')
		n = -n
	}
	b = strconv.AppendInt(b, n/100, 10)
	b = append(b, '.')
	frac := n % 100
	if frac < 10 {
		b = append(b, '0')
	}
	return strconv.AppendInt(b, frac, 10)
}

func appendStatus(b []byte, s sdktrace.ReadOnlySpan) []byte {
	if s.Status().Code != codes.Error {
		return b
	}
	msg := s.Status().Description
	if msg == "" {
		msg = "unknown"
	}
	b = append(b, " ⚠️ ERROR: "...)
	return append(b, msg...)
}

func appendTokenUsage(b []byte, s sdktrace.ReadOnlySpan) []byte {
	var in, out float64
	found := false
	for _, kv := range s.Attributes() {
		switch kv.Key {
		case "gen_ai.usage.input_tokens":
			in, found = numberOf(kv.Value), true
		case "gen_ai.usage.output_tokens":
			out, found = numberOf(kv.Value), true
		}
	}
	if !found {
		return b
	}
	b = append(b, ", "...)
	b = jsjson.AppendNumber(b, in+out)
	return append(b, " tokens"...)
}

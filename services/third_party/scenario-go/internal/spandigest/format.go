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
	span sdktrace.ReadOnlySpan
	// index is the span's position in the sorted span list.
	index    int
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
	return (*Cache)(nil).Format(spans)
}

// FormatStructureOnly renders the span tree without attributes or events,
// with each span's token usage, for traces too large to inline.
func FormatStructureOnly(spans []sdktrace.ReadOnlySpan) string {
	if len(spans) == 0 {
		return NoSpans
	}
	r := renderer{}
	sorted := SortByStartTime(spans)
	r.out.buf = make([]byte, 0, estimateSize(spans, true))
	r.summary(sorted)
	roots := buildHierarchy(sorted)
	for i, n := range roots {
		r.renderStructure(n, 0, i == len(roots)-1)
	}
	r.renderErrors(spans)
	return r.result(r.out.buf)
}

type renderer struct {
	out lines
	// seen holds the long strings the full digest showed so far.
	seen map[uint64]struct{}
	// indent is scratch for the attribute indent of the current node.
	indent []byte
}

func (r *renderer) summary(sorted []sdktrace.ReadOnlySpan) {
	b := r.out.start()
	b = append(b, "Spans: "...)
	b = strconv.AppendInt(b, int64(len(sorted)), 10)
	b = append(b, " | Total Duration: "...)
	b = appendDuration(b, totalDurationMs(sorted))
	r.out.buf = b
	r.out.add("")
}

// result turns a rendered buffer into the digest string. The buffer is
// never touched again, so it can back the string.
func (r *renderer) result(b []byte) string {
	return unsafe.String(unsafe.SliceData(b), len(b))
}

// renderFullDigest renders spans in full from their compiled forms, into
// the renderer's buffer, and returns it.
func (r *renderer) renderFullDigest(spans []sdktrace.ReadOnlySpan, cache *Cache) []byte {
	sorted := SortByStartTime(spans)
	compiled := cache.compiled(sorted)
	size := 64
	for _, cs := range compiled {
		size += len(cs.buf) + 16*cs.lines
	}
	r.out.buf = slices.Grow(r.out.buf[:0], size)
	r.summary(sorted)
	roots := buildHierarchy(sorted)
	r.seen = make(map[uint64]struct{}, 2*len(spans))
	for i, n := range roots {
		r.renderFull(n, compiled, 0, i == len(roots)-1)
	}
	r.renderErrors(spans)
	return r.out.buf
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

// appendHeader appends a span's header line, without its tree prefix.
func appendHeader(b []byte, s sdktrace.ReadOnlySpan, withTokens bool) []byte {
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
	b := appendTreePrefix(r.out.start(), depth, isLast)
	r.out.buf = appendHeader(b, n.span, true)
	r.out.add("")
	for i, c := range n.children {
		r.renderStructure(c, depth+1, i == len(n.children)-1)
	}
}

// renderFull renders a node and its subtree; compiled is indexed like the
// sorted spans the hierarchy was built from.
func (r *renderer) renderFull(n *node, compiled []compiledSpan, depth int, isLast bool) {
	cs := &compiled[n.index]
	r.indent = appendAttrIndent(r.indent[:0], depth, isLast)
	cs.appendTo(&r.out, appendTreePrefix(r.out.start(), depth, isLast), r.indent, r.seen)
	r.out.add("")
	for i, c := range n.children {
		r.renderFull(c, compiled, depth+1, i == len(n.children)-1)
	}
}

const (
	pipe        = "│   "
	blank       = "    "
	branch      = "├── "
	lastBranch  = "└── "
	attrPadding = "    "
)

// appendTreePrefix appends the box-drawing connector of a node at depth.
func appendTreePrefix(b []byte, depth int, isLast bool) []byte {
	if depth == 0 {
		return b
	}
	b = appendPipes(b, depth-1)
	if isLast {
		return append(b, lastBranch...)
	}
	return append(b, branch...)
}

// appendAttrIndent appends the indent of a node's attribute lines.
func appendAttrIndent(b []byte, depth int, isLast bool) []byte {
	if depth == 0 {
		return append(b, attrPadding...)
	}
	b = appendPipes(b, depth-1)
	if isLast {
		b = append(b, blank...)
	} else {
		b = append(b, pipe...)
	}
	return append(b, attrPadding...)
}

func appendPipes(b []byte, n int) []byte {
	for i := 0; i < n; i++ {
		b = append(b, pipe...)
	}
	return b
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
	byID := make(map[trace.SpanID]int, len(sorted))
	for i, s := range sorted {
		nodes[i].span, nodes[i].index = s, i
		byID[s.SpanContext().SpanID()] = i
	}
	// parent[i] is the index of node i's parent, or -1 for a root. Children
	// share one backing array, sized by a first counting pass.
	parent := make([]int, len(nodes))
	counts := make([]int, len(nodes))
	roots := 0
	for i := range nodes {
		parentID := nodes[i].span.Parent().SpanID()
		if p, ok := byID[parentID]; ok && parentID.IsValid() && p != i {
			parent[i] = p
			counts[p]++
		} else {
			parent[i] = -1
			roots++
		}
	}
	all := make([]*node, len(nodes))
	next := roots
	for i := range nodes {
		nodes[i].children = all[next : next : next+counts[i]]
		next += counts[i]
	}
	top := all[:0:roots]
	for i := range nodes {
		if p := parent[i]; p >= 0 {
			nodes[p].children = append(nodes[p].children, &nodes[i])
		} else {
			top = append(top, &nodes[i])
		}
	}
	return top
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

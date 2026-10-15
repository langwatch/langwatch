package spandigest

import (
	"hash/maphash"
	"slices"
	"sync"
	"unsafe"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/scenario/go/internal/jsjson"
	"github.com/langwatch/scenario/go/internal/jsstr"
)

// An ended span never changes, so everything the full digest shows of it
// (header, attributes and events, with JSON values parsed, media truncated
// and re-encoded) is rendered once into a compiledSpan. Only the
// deduplication of long strings depends on the spans rendered before it, so
// those strings stay separate pieces that carry both their text and their
// duplicate marker; rendering a digest is then a walk over the pieces.

// piece is a byte range of a compiledSpan's buffer. A dedup piece is a long
// string the deduplicator may replace: dup is the range of its marker and
// hash the key of its normalized text. lineEnd marks the last piece of a
// line.
type piece struct {
	start, end       int32
	dupStart, dupEnd int32
	hash             uint64
	dedup            bool
	lineEnd          bool
}

// compiledSpan is the pre-rendered full digest of one span: the header
// (without its tree prefix), then the attribute and event lines (without
// their indent). Every line has at least one piece.
type compiledSpan struct {
	buf    []byte
	pieces []piece
	lines  int
}

// dedupSeed keys the deduplicator's hashes; it is fixed per process so a
// compiled span can be shared by every digest that renders it.
var dedupSeed = maphash.MakeSeed()

// appendTo appends the span's lines to out, each line after the first
// starting with indent; long strings already in seen become the duplicate
// marker, the others are added to seen. The first line continues out's
// current line.
func (cs *compiledSpan) appendTo(out *lines, b []byte, indent []byte, seen map[uint64]struct{}) {
	for i, p := range cs.pieces {
		if p.dedup {
			if _, dup := seen[p.hash]; dup {
				b = append(b, cs.buf[p.dupStart:p.dupEnd]...)
			} else {
				seen[p.hash] = struct{}{}
				b = append(b, cs.buf[p.start:p.end]...)
			}
		} else {
			b = append(b, cs.buf[p.start:p.end]...)
		}
		if p.lineEnd && i < len(cs.pieces)-1 {
			out.buf = b
			b = append(out.start(), indent...)
		}
	}
	out.buf = b
}

// compiler renders spans into compiledSpans. Bytes are appended to buf and
// become a literal piece when a dedup piece or a line end closes them. Its
// buffers are reused from span to span; each compiledSpan gets an exact
// copy.
type compiler struct {
	buf    []byte
	pieces []piece
	lines  int
	// lit is where the pending literal starts.
	lit     int
	scratch []byte
	attrs   []cleanAttribute
	// inner renders nested JSON documents, one level down.
	inner *compiler
	// keys holds the member keys of the objects being scanned, innermost
	// last.
	keys []string
}

func (c *compiler) reset() {
	c.buf, c.pieces, c.lines, c.lit = c.buf[:0], c.pieces[:0], 0, 0
}

// span renders the constant parts of a span's full digest.
func (c *compiler) span(s sdktrace.ReadOnlySpan) compiledSpan {
	c.reset()
	c.buf = appendHeader(c.buf, s, false)
	c.endLine()
	c.attrs = cleanAttributes(c.attrs, s.Attributes())
	for _, a := range c.attrs {
		c.attrLine("", a)
	}
	for _, ev := range s.Events() {
		c.buf = append(c.buf, "[event] "...)
		c.buf = append(c.buf, ev.Name...)
		c.endLine()
		c.attrs = cleanAttributes(c.attrs, ev.Attributes)
		for _, a := range c.attrs {
			c.attrLine("  ", a)
		}
	}
	return compiledSpan{buf: slices.Clone(c.buf), pieces: slices.Clone(c.pieces), lines: c.lines}
}

// nested returns the reset compiler for a nested JSON document.
func (c *compiler) nested() *compiler {
	if c.inner == nil {
		c.inner = &compiler{}
	}
	c.inner.reset()
	return c.inner
}

func (c *compiler) flush() {
	if len(c.buf) > c.lit {
		c.pieces = append(c.pieces, piece{start: int32(c.lit), end: int32(len(c.buf))})
	}
	c.lit = len(c.buf)
}

func (c *compiler) endLine() {
	c.flush()
	c.pieces[len(c.pieces)-1].lineEnd = true
	c.lines++
}

// beginDedup starts a dedup piece: its text is appended next.
func (c *compiler) beginDedup() int {
	c.flush()
	return len(c.buf)
}

// endDedup closes the dedup piece whose text starts at start, appending its
// marker.
func (c *compiler) endDedup(start int, marker []byte, hash uint64) {
	p := piece{start: int32(start), end: int32(len(c.buf)), hash: hash, dedup: true}
	c.buf = append(c.buf, marker...)
	p.dupStart, p.dupEnd = p.end, int32(len(c.buf))
	c.pieces = append(c.pieces, p)
	c.lit = len(c.buf)
}

// dedupHash is the deduplicator's key of a string: its normalized form.
func (c *compiler) dedupHash(s string) uint64 {
	c.scratch = appendNormalized(c.scratch[:0], s)
	return maphash.Bytes(dedupSeed, c.scratch)
}

func isDedupCandidate(s string) bool {
	return len(s) >= DedupThreshold && jsstr.Len(s) >= DedupThreshold
}

func (c *compiler) attrLine(extra string, a cleanAttribute) {
	c.buf = append(c.buf, extra...)
	c.buf = append(c.buf, a.key...)
	c.buf = append(c.buf, ": "...)
	c.attrValue(a.value)
	c.endLine()
}

// attrValue renders a value as it appears after "key: ": a JSON string is
// parsed and re-encoded, a media data URL becomes a marker, other text is
// shown as is; non-string values are shown as their JSON.
func (c *compiler) attrValue(v attribute.Value) {
	if v.Type() != attribute.STRING {
		c.value(jsValue(v))
		return
	}
	s := v.AsString()
	if jsjson.LooksLikeJSON(s) && c.document(s) {
		return
	}
	if truncated, ok := truncateMediaURL(s); ok {
		c.buf = append(c.buf, truncated...)
		return
	}
	if isDedupCandidate(s) {
		start := c.beginDedup()
		c.buf = append(c.buf, s...)
		c.endDedup(start, rawMarker, c.dedupHash(s))
		return
	}
	c.buf = append(c.buf, s...)
}

// The duplicate marker as plain text and as a JSON string.
var (
	rawMarker    = []byte(duplicateMarker)
	quotedMarker = []byte(`"` + duplicateMarker + `"`)
)

// value appends the JSON of a parsed value, truncating media parts and
// transforming every string within.
func (c *compiler) value(v any) {
	if part, ok := truncateMediaPart(v); ok {
		c.buf = jsjson.Append(c.buf, part)
		return
	}
	switch x := v.(type) {
	case string:
		c.str(x)
	case []any:
		c.buf = append(c.buf, '[')
		for i, e := range x {
			if i > 0 {
				c.buf = append(c.buf, ',')
			}
			c.value(e)
		}
		c.buf = append(c.buf, ']')
	case jsjson.Object:
		c.buf = append(c.buf, '{')
		for i, m := range x {
			if i > 0 {
				c.buf = append(c.buf, ',')
			}
			c.buf = jsjson.AppendString(c.buf, m.Key)
			c.buf = append(c.buf, ':')
			c.value(m.Value)
		}
		c.buf = append(c.buf, '}')
	default:
		c.buf = jsjson.Append(c.buf, x)
	}
}

// str appends a string inside JSON: a nested JSON document is re-encoded
// and embedded as a string, a media data URL becomes a marker, a long
// string a dedup piece.
func (c *compiler) str(s string) {
	if jsjson.LooksLikeJSON(s) {
		if inner := c.nested(); inner.document(s) {
			inner.flush()
			c.embed(inner)
			return
		}
	}
	if truncated, ok := truncateMediaURL(s); ok {
		c.buf = jsjson.AppendString(c.buf, truncated)
		return
	}
	if isDedupCandidate(s) {
		start := c.beginDedup()
		c.buf = jsjson.AppendString(c.buf, s)
		c.endDedup(start, quotedMarker, c.dedupHash(s))
		return
	}
	c.buf = jsjson.AppendString(c.buf, s)
}

// mark is a compiler position to roll back to.
type mark struct{ buf, pieces, lit int }

func (c *compiler) mark() mark { return mark{len(c.buf), len(c.pieces), c.lit} }

func (c *compiler) rollback(m mark) {
	c.buf, c.pieces, c.lit = c.buf[:m.buf], c.pieces[:m.pieces], m.lit
}

// document appends the JSON document s exactly as value(jsjson.Parse(s))
// would, but transcodes it as it scans instead of building its tree. It
// reports false, leaving c unchanged, when s is not valid JSON.
func (c *compiler) document(s string) bool {
	m := c.mark()
	sc := jsjson.NewScanner(s)
	sc.SkipSpace()
	if c.scan(sc, 0) && sc.Done() {
		return true
	}
	c.rollback(m)
	return false
}

// scan transcodes the next value, at nesting depth.
func (c *compiler) scan(sc *jsjson.Scanner, depth int) bool {
	if depth > jsjson.MaxDepth {
		return false
	}
	ch, ok := sc.Peek()
	if !ok {
		return false
	}
	switch {
	case ch == '{':
		return c.scanObject(sc, depth)
	case ch == '[':
		return c.scanArray(sc, depth)
	case ch == '"':
		s, err := sc.String()
		if err != nil {
			return false
		}
		c.str(s)
	case ch == 't' || ch == 'f' || ch == 'n':
		v, err := sc.Literal()
		if err != nil {
			return false
		}
		c.buf = jsjson.Append(c.buf, v)
	case ch == '-' || (ch >= '0' && ch <= '9'):
		f, err := sc.Number()
		if err != nil {
			return false
		}
		c.buf = jsjson.AppendNumber(c.buf, f)
	default:
		return false
	}
	return true
}

func (c *compiler) scanArray(sc *jsjson.Scanner, depth int) bool {
	sc.Next() // [
	c.buf = append(c.buf, '[')
	sc.SkipSpace()
	if ch, _ := sc.Peek(); ch == ']' {
		sc.Next()
		c.buf = append(c.buf, ']')
		return true
	}
	for first := true; ; first = false {
		if !first {
			c.buf = append(c.buf, ',')
		}
		sc.SkipSpace()
		if !c.scan(sc, depth+1) {
			return false
		}
		sc.SkipSpace()
		ch, ok := sc.Peek()
		if !ok {
			return false
		}
		sc.Next()
		switch ch {
		case ',':
			continue
		case ']':
			c.buf = append(c.buf, ']')
			return true
		}
		return false
	}
}

// scanObject transcodes an object. An object whose rendering needs more
// than one pass (a repeated key, which JSON.parse merges, or a media part,
// which may be truncated as a whole) is parsed into a tree instead.
func (c *compiler) scanObject(sc *jsjson.Scanner, depth int) bool {
	start, m, base := sc.Offset(), c.mark(), len(c.keys)
	defer func() { c.keys = c.keys[:base] }()
	sc.Next() // {
	c.buf = append(c.buf, '{')
	sc.SkipSpace()
	if ch, _ := sc.Peek(); ch == '}' {
		sc.Next()
		c.buf = append(c.buf, '}')
		return true
	}
	for first := true; ; first = false {
		sc.SkipSpace()
		if ch, _ := sc.Peek(); ch != '"' {
			return false
		}
		key, err := sc.String()
		if err != nil {
			return false
		}
		if slices.Contains(c.keys[base:], key) || (key == "type" && isMediaPartType(sc)) {
			c.rollback(m)
			sc.SetOffset(start)
			return c.treeValue(sc, depth)
		}
		c.keys = append(c.keys, key)
		sc.SkipSpace()
		if ch, _ := sc.Peek(); ch != ':' {
			return false
		}
		sc.Next()
		sc.SkipSpace()
		if !first {
			c.buf = append(c.buf, ',')
		}
		c.buf = jsjson.AppendString(c.buf, key)
		c.buf = append(c.buf, ':')
		if !c.scan(sc, depth+1) {
			return false
		}
		sc.SkipSpace()
		ch, ok := sc.Peek()
		if !ok {
			return false
		}
		sc.Next()
		switch ch {
		case ',':
			continue
		case '}':
			c.buf = append(c.buf, '}')
			return true
		}
		return false
	}
}

// isMediaPartType reports whether the value after a "type" key (the colon
// still to come) is "file" or "image", the parts truncateMediaPart handles.
// It does not move the scanner.
func isMediaPartType(sc *jsjson.Scanner) bool {
	at := sc.Offset()
	defer sc.SetOffset(at)
	sc.SkipSpace()
	if ch, _ := sc.Peek(); ch != ':' {
		return false
	}
	sc.Next()
	sc.SkipSpace()
	if ch, _ := sc.Peek(); ch != '"' {
		return false
	}
	v, err := sc.String()
	return err == nil && (v == "file" || v == "image")
}

// treeValue parses the next value into a tree and appends it.
func (c *compiler) treeValue(sc *jsjson.Scanner, depth int) bool {
	v, err := sc.Value(depth)
	if err != nil {
		return false
	}
	c.value(v)
	return true
}

// embed appends the JSON text inner rendered as a JSON string: quoted, with
// every piece escaped. Escaping works character by character and pieces end
// on character boundaries, so escaping each piece equals escaping the text.
func (c *compiler) embed(inner *compiler) {
	c.buf = append(c.buf, '"')
	for _, p := range inner.pieces {
		if !p.dedup {
			c.buf = appendEscaped(c.buf, inner.buf[p.start:p.end])
			continue
		}
		start := c.beginDedup()
		c.buf = appendEscaped(c.buf, inner.buf[p.start:p.end])
		c.scratch = appendEscaped(c.scratch[:0], inner.buf[p.dupStart:p.dupEnd])
		c.endDedup(start, c.scratch, p.hash)
	}
	c.buf = append(c.buf, '"')
}

// appendEscaped appends b escaped as the inside of a JSON string.
func appendEscaped(dst, b []byte) []byte {
	n := len(dst)
	dst = jsjson.AppendString(dst, string(b))
	// Drop the quotes AppendString wraps the text in.
	copy(dst[n:], dst[n+1:len(dst)-1])
	return dst[:len(dst)-2]
}

// spanKey identifies a span across digests.
type spanKey struct {
	traceID trace.TraceID
	spanID  trace.SpanID
}

func keyOf(s sdktrace.ReadOnlySpan) spanKey {
	sc := s.SpanContext()
	return spanKey{traceID: sc.TraceID(), spanID: sc.SpanID()}
}

// Cache keeps the compiled form of the spans of one conversation, so the
// judge's digest of a growing trace renders each span's attributes once
// instead of on every call. A nil *Cache formats without caching. It is
// safe for concurrent use.
type Cache struct {
	mu    sync.Mutex
	spans map[spanKey]compiledSpan
	comp  compiler
}

// NewCache returns an empty cache.
func NewCache() *Cache { return &Cache{spans: map[spanKey]compiledSpan{}} }

// compiled returns the compiled form of every span, compiling the new ones.
func (c *Cache) compiled(spans []sdktrace.ReadOnlySpan) []compiledSpan {
	out := make([]compiledSpan, len(spans))
	if c == nil {
		var comp compiler
		for i, s := range spans {
			out[i] = comp.span(s)
		}
		return out
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, s := range spans {
		k := keyOf(s)
		cs, ok := c.spans[k]
		if !ok {
			cs = c.comp.span(s)
			c.spans[k] = cs
		}
		out[i] = cs
	}
	return out
}

// Format is Format over the cache.
func (c *Cache) Format(spans []sdktrace.ReadOnlySpan) string {
	if len(spans) == 0 {
		return NoSpans
	}
	r := renderer{}
	return r.result(r.renderFullDigest(spans, c))
}

// scratchPool holds the buffers Framed renders digests into before copying
// them into their frame. Buffers above maxPooledScratch are not kept.
var scratchPool = sync.Pool{New: func() any { return new([]byte) }}

const maxPooledScratch = 4 << 20

// Framed returns the parts of head, the digest of spans and the parts of
// tail joined in one string, as the judge's message embeds the digest. The
// digest is the full one, or, when that exceeds maxTokens, the
// structure-only one followed by LargeTraceHint; large reports the latter.
func (c *Cache) Framed(head, tail []string, spans []sdktrace.ReadOnlySpan, maxTokens int) (framed string, large bool) {
	scratch := scratchPool.Get().(*[]byte)
	defer func() {
		if cap(*scratch) <= maxPooledScratch {
			scratchPool.Put(scratch)
		}
	}()
	digest := []byte(NoSpans)
	if len(spans) > 0 {
		r := renderer{out: lines{buf: (*scratch)[:0]}}
		digest = r.renderFullDigest(spans, c)
		*scratch = digest
		if EstimateTokens(unsafe.String(unsafe.SliceData(digest), len(digest))) > maxTokens {
			digest = append([]byte(FormatStructureOnly(spans)), LargeTraceHint...)
			large = true
		}
	}
	n := len(digest)
	for _, p := range head {
		n += len(p)
	}
	for _, p := range tail {
		n += len(p)
	}
	out := make([]byte, 0, n)
	for _, p := range head {
		out = append(out, p...)
	}
	out = append(out, digest...)
	for _, p := range tail {
		out = append(out, p...)
	}
	// out is never touched again, so it can back the string.
	return unsafe.String(unsafe.SliceData(out), len(out)), large
}

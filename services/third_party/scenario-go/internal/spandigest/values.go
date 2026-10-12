package spandigest

import (
	"hash/maphash"
	"strings"
	"unicode"
	"unicode/utf8"

	"go.opentelemetry.io/otel/attribute"

	"github.com/langwatch/scenario/go/internal/jsjson"
	"github.com/langwatch/scenario/go/internal/jsstr"
)

// excludedAttributeKeys are infrastructure attributes the judge never needs.
var excludedAttributeKeys = [...]attribute.Key{
	"langwatch.thread.id",
	"langwatch.scenario.id",
	"langwatch.scenario.name",
}

// cleanAttribute is one attribute after cleaning: the langwatch. prefix is
// stripped from its key.
type cleanAttribute struct {
	key   string
	value attribute.Value
}

// cleanAttributes drops infrastructure attributes, strips the langwatch.
// prefix and keeps the first attribute of every cleaned key, in order.
func cleanAttributes(dst []cleanAttribute, attrs []attribute.KeyValue) []cleanAttribute {
	dst = dst[:0]
next:
	for _, kv := range attrs {
		for _, ex := range excludedAttributeKeys {
			if kv.Key == ex {
				continue next
			}
		}
		key := strings.TrimPrefix(string(kv.Key), "langwatch.")
		for i := range dst {
			if dst[i].key == key {
				continue next
			}
		}
		dst = append(dst, cleanAttribute{key: key, value: kv.Value})
	}
	return dst
}

// jsValue converts an attribute value to the value JavaScript's OTel SDK
// would hold for it.
func jsValue(v attribute.Value) any {
	switch v.Type() {
	case attribute.BOOL:
		return v.AsBool()
	case attribute.INT64:
		return float64(v.AsInt64())
	case attribute.FLOAT64:
		return v.AsFloat64()
	case attribute.STRING:
		return v.AsString()
	case attribute.BOOLSLICE:
		s := v.AsBoolSlice()
		out := make([]any, len(s))
		for i, e := range s {
			out[i] = e
		}
		return out
	case attribute.INT64SLICE:
		s := v.AsInt64Slice()
		out := make([]any, len(s))
		for i, e := range s {
			out[i] = float64(e)
		}
		return out
	case attribute.FLOAT64SLICE:
		s := v.AsFloat64Slice()
		out := make([]any, len(s))
		for i, e := range s {
			out[i] = e
		}
		return out
	case attribute.STRINGSLICE:
		s := v.AsStringSlice()
		out := make([]any, len(s))
		for i, e := range s {
			out[i] = e
		}
		return out
	}
	return nil
}

// numberOf mirrors JavaScript's Number(value) || 0 for token counts.
func numberOf(v attribute.Value) float64 {
	switch v.Type() {
	case attribute.INT64:
		return float64(v.AsInt64())
	case attribute.FLOAT64:
		return v.AsFloat64()
	case attribute.BOOL:
		if v.AsBool() {
			return 1
		}
	case attribute.STRING:
		val, err := jsjson.Parse(strings.TrimSpace(v.AsString()))
		if f, ok := val.(float64); ok && err == nil {
			return f
		}
	}
	return 0
}

// deepTransform applies fn to v; when fn returns a replacement the branch
// stops there, otherwise it descends into arrays and objects. Mirrors the
// JS deep-transform helper. It rewrites v in place, so v must be owned by
// the caller (a fresh parse or a fresh attribute conversion).
func deepTransform(v any, fn func(any) (any, bool)) any {
	if r, replaced := fn(v); replaced {
		return r
	}
	switch x := v.(type) {
	case []any:
		for i := range x {
			x[i] = deepTransform(x[i], fn)
		}
	case jsjson.Object:
		for i := range x {
			x[i].Value = deepTransform(x[i].Value, fn)
		}
	}
	return v
}

// truncateMediaURL replaces a base64 image/audio/video data URL by a marker.
func truncateMediaURL(s string) (string, bool) {
	if len(s) < 5 || !strings.EqualFold(s[:5], "data:") {
		return s, false
	}
	rest := s[5:]
	slash := strings.IndexByte(rest, '/')
	if slash <= 0 {
		return s, false
	}
	category := rest[:slash]
	if !strings.EqualFold(category, "image") && !strings.EqualFold(category, "audio") && !strings.EqualFold(category, "video") {
		return s, false
	}
	semi := strings.IndexByte(rest, ';')
	if semi <= slash+1 {
		return s, false
	}
	for i := slash + 1; i < semi; i++ {
		if !isMimeSubtypeChar(rest[i]) {
			return s, false
		}
	}
	tail := rest[semi:]
	if len(tail) < 8 || !strings.EqualFold(tail[:8], ";base64,") {
		return s, false
	}
	data := tail[8:]
	if data == "" || strings.ContainsAny(data, "\n\r  ") {
		return s, false
	}
	mime := rest[:semi]
	return mediaMarker(strings.ToUpper(category), mime, jsstr.Len(data)), true
}

func isMimeSubtypeChar(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '+' || c == '.' || c == '-'
}

func mediaMarker(category, mime string, size int) string {
	var b strings.Builder
	b.Grow(len(category) + len(mime) + 20)
	b.WriteByte('[')
	b.WriteString(category)
	b.WriteString(": ")
	b.WriteString(mime)
	b.WriteString(", ~")
	b.WriteString(itoa(size))
	b.WriteString(" bytes]")
	return b.String()
}

func itoa(n int) string {
	var buf [20]byte
	return string(jsjson.AppendNumber(buf[:0], float64(n)))
}

// truncateMediaPart replaces the base64 payload of an AI SDK file or image
// part with a marker. It reports false when v is not such a part.
func truncateMediaPart(v any) (any, bool) {
	obj, ok := v.(jsjson.Object)
	if !ok {
		return nil, false
	}
	typ, _ := obj.Get("type")
	switch typ {
	case "file":
		mediaType, ok1 := getString(obj, "mediaType")
		data, ok2 := getString(obj, "data")
		if !ok1 || !ok2 {
			return nil, false
		}
		category, _, _ := strings.Cut(mediaType, "/")
		return replaceMember(obj, "data", mediaMarker(strings.ToUpper(category), mediaType, jsstr.Len(data))), true
	case "image":
		image, ok := getString(obj, "image")
		if !ok {
			return nil, false
		}
		if marker, ok := truncateImageDataURL(image); ok {
			return replaceMember(obj, "image", marker), true
		}
		if len(image) > 1000 && isBase64Charset(image) {
			return replaceMember(obj, "image", mediaMarker("IMAGE", "unknown", len(image))), true
		}
	}
	return nil, false
}

func truncateImageDataURL(s string) (string, bool) {
	marker, ok := truncateMediaURL(s)
	if !ok || !strings.HasPrefix(marker, "[IMAGE: ") {
		return "", false
	}
	return marker, true
}

func getString(obj jsjson.Object, key string) (string, bool) {
	v, ok := obj.Get(key)
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	return s, ok
}

func replaceMember(obj jsjson.Object, key string, value any) jsjson.Object {
	out := make(jsjson.Object, len(obj))
	copy(out, obj)
	for i := range out {
		if out[i].Key == key {
			out[i].Value = value
		}
	}
	return out
}

func isBase64Charset(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/' || c == '=') {
			return false
		}
	}
	return true
}

// FormatValue renders an attribute value for display without deduplication:
// media is truncated and JSON strings are normalized recursively.
func FormatValue(v attribute.Value) string {
	if v.Type() == attribute.STRING {
		if s, ok := transformValue(v.AsString()).(string); ok {
			return s
		}
	}
	processed := transformValue(jsValue(v))
	if s, ok := processed.(string); ok {
		return s
	}
	return jsjson.Stringify(processed)
}

func transformValue(v any) any {
	return deepTransform(v, func(x any) (any, bool) {
		if part, ok := truncateMediaPart(x); ok {
			return part, true
		}
		s, ok := x.(string)
		if !ok {
			return nil, false
		}
		if truncated, ok := truncateMediaURL(s); ok {
			return truncated, true
		}
		if jsjson.LooksLikeJSON(s) {
			if parsed, err := jsjson.Parse(s); err == nil {
				return jsjson.Stringify(transformValue(parsed)), true
			}
		}
		return nil, false
	})
}

// deduplicator replaces repeated long strings with a marker. One instance
// lives for one digest.
//
// Seen strings are keyed by a 64-bit hash of their normalized form, built in
// a reused scratch buffer, so checking a string allocates nothing.
type deduplicator struct {
	threshold int
	seen      map[uint64]struct{}
	seed      maphash.Seed
	scratch   []byte
}

const duplicateMarker = "[DUPLICATE - SEE ABOVE]"

func (d *deduplicator) process(s string) string {
	if len(s) < d.threshold || jsstr.Len(s) < d.threshold {
		return s
	}
	if d.seen == nil {
		d.seen = make(map[uint64]struct{})
		d.seed = maphash.MakeSeed()
	}
	d.scratch = appendNormalized(d.scratch[:0], s)
	key := maphash.Bytes(d.seed, d.scratch)
	if _, dup := d.seen[key]; dup {
		return duplicateMarker
	}
	d.seen[key] = struct{}{}
	return s
}

// normalizeForDedup collapses whitespace (actual and JSON-escaped), trims and
// lowercases, matching the JS deduplicator's comparison key.
func normalizeForDedup(s string) string { return string(appendNormalized(nil, s)) }

func appendNormalized(buf []byte, s string) []byte {
	space := false
	for i := 0; i < len(s); {
		c := s[i]
		if c == '\\' && i+1 < len(s) && (s[i+1] == 'n' || s[i+1] == 'r' || s[i+1] == 't') {
			space = true
			i += 2
			continue
		}
		if c < utf8.RuneSelf {
			if c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f' {
				space = true
				i++
				continue
			}
			if space && len(buf) > 0 {
				buf = append(buf, ' ')
			}
			space = false
			if c >= 'A' && c <= 'Z' {
				c += 'a' - 'A'
			}
			buf = append(buf, c)
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		i += size
		if unicode.IsSpace(r) || r == 0xFEFF {
			space = true
			continue
		}
		if space && len(buf) > 0 {
			buf = append(buf, ' ')
		}
		space = false
		buf = utf8.AppendRune(buf, unicode.ToLower(r))
	}
	return buf
}

// appendValue appends an attribute value rendered like FormatValue, with
// long repeated strings replaced by a duplicate marker.
func (d *deduplicator) appendValue(dst []byte, v attribute.Value) []byte {
	if v.Type() == attribute.STRING {
		return d.appendString(dst, v.AsString())
	}
	processed := d.transform(jsValue(v))
	if s, ok := processed.(string); ok {
		return append(dst, s...)
	}
	return jsjson.Append(dst, processed)
}

func (d *deduplicator) transform(v any) any {
	return deepTransform(v, func(x any) (any, bool) {
		if part, ok := truncateMediaPart(x); ok {
			return part, true
		}
		s, ok := x.(string)
		if !ok {
			return nil, false
		}
		return d.transformString(s), true
	})
}

// appendString appends the transformed string: re-encoded JSON, a media
// marker, or the (possibly deduplicated) text.
func (d *deduplicator) appendString(dst []byte, s string) []byte {
	if jsjson.LooksLikeJSON(s) {
		if parsed, err := jsjson.Parse(s); err == nil {
			return jsjson.Append(dst, d.transform(parsed))
		}
	}
	if truncated, ok := truncateMediaURL(s); ok {
		return append(dst, truncated...)
	}
	return append(dst, d.process(s)...)
}

func (d *deduplicator) transformString(s string) string {
	if jsjson.LooksLikeJSON(s) {
		if parsed, err := jsjson.Parse(s); err == nil {
			return jsjson.Stringify(d.transform(parsed))
		}
	}
	if truncated, ok := truncateMediaURL(s); ok {
		return truncated
	}
	return d.process(s)
}

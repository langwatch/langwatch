// Package jsjson parses and serializes JSON the way JavaScript's JSON.parse and
// JSON.stringify do: object key order is preserved, numbers are float64 and
// are printed with JavaScript's Number#toString rules, and strings are escaped
// without HTML escaping.
//
// The judge prompt and the LangWatch wire format are produced by the JS SDK
// with JSON.stringify; reproducing its output byte for byte keeps the Go SDK's
// prompts and payloads identical to the reference.
package jsjson

import (
	"errors"
	"math"
	"strconv"
	"unicode/utf16"
	"unicode/utf8"
)

// Member is one key/value pair of an Object.
type Member struct {
	Key   string
	Value any
}

// Object is a JSON object that keeps its keys in source order.
type Object []Member

// Get returns the value stored under key and whether it exists.
func (o Object) Get(key string) (any, bool) {
	for i := range o {
		if o[i].Key == key {
			return o[i].Value, true
		}
	}
	return nil, false
}

// Raw is pre-encoded JSON written verbatim by Append.
type Raw []byte

var errSyntax = errors.New("jsjson: invalid JSON")

// Parse decodes s into nil, bool, float64, string, []any or Object.
func Parse(s string) (any, error) {
	p := parser{s: s}
	p.skipSpace()
	v, err := p.value(0)
	if err != nil {
		return nil, err
	}
	p.skipSpace()
	if p.i != len(p.s) {
		return nil, errSyntax
	}
	return v, nil
}

const maxDepth = 10000

type parser struct {
	s string
	i int
}

func (p *parser) skipSpace() {
	for p.i < len(p.s) {
		switch p.s[p.i] {
		case ' ', '\t', '\n', '\r':
			p.i++
		default:
			return
		}
	}
}

func (p *parser) value(depth int) (any, error) {
	if depth > maxDepth || p.i >= len(p.s) {
		return nil, errSyntax
	}
	switch c := p.s[p.i]; {
	case c == '{':
		return p.object(depth)
	case c == '[':
		return p.array(depth)
	case c == '"':
		return p.str()
	case c == 't':
		return p.literal("true", true)
	case c == 'f':
		return p.literal("false", false)
	case c == 'n':
		return p.literal("null", nil)
	case c == '-' || (c >= '0' && c <= '9'):
		f, err := p.number()
		if err != nil {
			return nil, err
		}
		return f, nil
	}
	return nil, errSyntax
}

func (p *parser) literal(word string, v any) (any, error) {
	if len(p.s)-p.i < len(word) || p.s[p.i:p.i+len(word)] != word {
		return nil, errSyntax
	}
	p.i += len(word)
	return v, nil
}

func (p *parser) object(depth int) (any, error) {
	p.i++ // {
	obj := make(Object, 0, 4)
	p.skipSpace()
	if p.i < len(p.s) && p.s[p.i] == '}' {
		p.i++
		return obj, nil
	}
	for {
		p.skipSpace()
		if p.i >= len(p.s) || p.s[p.i] != '"' {
			return nil, errSyntax
		}
		key, err := p.str()
		if err != nil {
			return nil, err
		}
		p.skipSpace()
		if p.i >= len(p.s) || p.s[p.i] != ':' {
			return nil, errSyntax
		}
		p.i++
		p.skipSpace()
		v, err := p.value(depth + 1)
		if err != nil {
			return nil, err
		}
		obj = obj.set(key, v)
		p.skipSpace()
		if p.i >= len(p.s) {
			return nil, errSyntax
		}
		if p.s[p.i] == ',' {
			p.i++
			continue
		}
		if p.s[p.i] == '}' {
			p.i++
			return obj, nil
		}
		return nil, errSyntax
	}
}

// set mirrors JSON.parse: a repeated key keeps its first position and takes
// the last value.
func (o Object) set(key string, v any) Object {
	for i := range o {
		if o[i].Key == key {
			o[i].Value = v
			return o
		}
	}
	return append(o, Member{Key: key, Value: v})
}

func (p *parser) array(depth int) (any, error) {
	p.i++ // [
	arr := make([]any, 0, 4)
	p.skipSpace()
	if p.i < len(p.s) && p.s[p.i] == ']' {
		p.i++
		return arr, nil
	}
	for {
		p.skipSpace()
		v, err := p.value(depth + 1)
		if err != nil {
			return nil, err
		}
		arr = append(arr, v)
		p.skipSpace()
		if p.i >= len(p.s) {
			return nil, errSyntax
		}
		if p.s[p.i] == ',' {
			p.i++
			continue
		}
		if p.s[p.i] == ']' {
			p.i++
			return arr, nil
		}
		return nil, errSyntax
	}
}

func (p *parser) number() (float64, error) {
	start := p.i
	if p.s[p.i] == '-' {
		p.i++
	}
	if p.i >= len(p.s) {
		return 0, errSyntax
	}
	if p.s[p.i] == '0' {
		p.i++
	} else if p.s[p.i] >= '1' && p.s[p.i] <= '9' {
		p.digits()
	} else {
		return 0, errSyntax
	}
	if p.i < len(p.s) && p.s[p.i] == '.' {
		p.i++
		if !p.digits() {
			return 0, errSyntax
		}
	}
	if p.i < len(p.s) && (p.s[p.i] == 'e' || p.s[p.i] == 'E') {
		p.i++
		if p.i < len(p.s) && (p.s[p.i] == '+' || p.s[p.i] == '-') {
			p.i++
		}
		if !p.digits() {
			return 0, errSyntax
		}
	}
	f, err := strconv.ParseFloat(p.s[start:p.i], 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return 0, errSyntax
	}
	return f, nil
}

func (p *parser) digits() bool {
	start := p.i
	for p.i < len(p.s) && p.s[p.i] >= '0' && p.s[p.i] <= '9' {
		p.i++
	}
	return p.i > start
}

func (p *parser) str() (string, error) {
	p.i++ // opening quote
	start := p.i
	// Fast path: no escapes.
	for p.i < len(p.s) {
		c := p.s[p.i]
		if c == '"' {
			s := p.s[start:p.i]
			p.i++
			return s, nil
		}
		if c == '\\' {
			break
		}
		if c < 0x20 {
			return "", errSyntax
		}
		p.i++
	}
	buf := []byte(p.s[start:p.i])
	for p.i < len(p.s) {
		c := p.s[p.i]
		switch {
		case c == '"':
			p.i++
			return string(buf), nil
		case c < 0x20:
			return "", errSyntax
		case c != '\\':
			buf = append(buf, c)
			p.i++
			continue
		}
		p.i++ // backslash
		if p.i >= len(p.s) {
			return "", errSyntax
		}
		esc := p.s[p.i]
		p.i++
		switch esc {
		case '"', '\\', '/':
			buf = append(buf, esc)
		case 'b':
			buf = append(buf, '\b')
		case 'f':
			buf = append(buf, '\f')
		case 'n':
			buf = append(buf, '\n')
		case 'r':
			buf = append(buf, '\r')
		case 't':
			buf = append(buf, '\t')
		case 'u':
			r, ok := p.hex4()
			if !ok {
				return "", errSyntax
			}
			if utf16.IsSurrogate(r) {
				if r2, ok2 := p.lowSurrogate(); ok2 {
					r = utf16.DecodeRune(r, r2)
				} else {
					r = utf8.RuneError
				}
			}
			buf = utf8.AppendRune(buf, r)
		default:
			return "", errSyntax
		}
	}
	return "", errSyntax
}

func (p *parser) hex4() (rune, bool) {
	if len(p.s)-p.i < 4 {
		return 0, false
	}
	v, err := strconv.ParseUint(p.s[p.i:p.i+4], 16, 32)
	if err != nil {
		return 0, false
	}
	p.i += 4
	return rune(v), true
}

func (p *parser) lowSurrogate() (rune, bool) {
	if len(p.s)-p.i < 6 || p.s[p.i] != '\\' || p.s[p.i+1] != 'u' {
		return 0, false
	}
	save := p.i
	p.i += 2
	r, ok := p.hex4()
	if !ok || r < 0xDC00 || r > 0xDFFF {
		p.i = save
		return 0, false
	}
	return r, true
}

// Stringify returns JSON.stringify(v).
func Stringify(v any) string {
	return string(Append(nil, v))
}

// Append appends JSON.stringify(v) to dst. Supported values: nil, bool,
// float64, float32, int, int64, string, []any, []string, Object, Raw.
// Unsupported values are written as null.
func Append(dst []byte, v any) []byte {
	switch x := v.(type) {
	case nil:
		return append(dst, "null"...)
	case bool:
		if x {
			return append(dst, "true"...)
		}
		return append(dst, "false"...)
	case string:
		return AppendString(dst, x)
	case float64:
		return AppendNumber(dst, x)
	case float32:
		return AppendNumber(dst, float64(x))
	case int:
		return strconv.AppendInt(dst, int64(x), 10)
	case int64:
		return AppendNumber(dst, float64(x))
	case Raw:
		return append(dst, x...)
	case []any:
		dst = append(dst, '[')
		for i, e := range x {
			if i > 0 {
				dst = append(dst, ',')
			}
			dst = Append(dst, e)
		}
		return append(dst, ']')
	case []string:
		dst = append(dst, '[')
		for i, e := range x {
			if i > 0 {
				dst = append(dst, ',')
			}
			dst = AppendString(dst, e)
		}
		return append(dst, ']')
	case Object:
		dst = append(dst, '{')
		for i, m := range x {
			if i > 0 {
				dst = append(dst, ',')
			}
			dst = AppendString(dst, m.Key)
			dst = append(dst, ':')
			dst = Append(dst, m.Value)
		}
		return append(dst, '}')
	}
	return append(dst, "null"...)
}

const hexDigits = "0123456789abcdef"

// AppendString appends s as a JSON string literal escaped like JSON.stringify:
// quotes, backslashes and control characters only. Invalid UTF-8 becomes
// U+FFFD.
func AppendString(dst []byte, s string) []byte {
	dst = append(dst, '"')
	start := 0
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			if c >= 0x20 && c != '"' && c != '\\' {
				i++
				continue
			}
			dst = append(dst, s[start:i]...)
			switch c {
			case '"':
				dst = append(dst, '\\', '"')
			case '\\':
				dst = append(dst, '\\', '\\')
			case '\b':
				dst = append(dst, '\\', 'b')
			case '\f':
				dst = append(dst, '\\', 'f')
			case '\n':
				dst = append(dst, '\\', 'n')
			case '\r':
				dst = append(dst, '\\', 'r')
			case '\t':
				dst = append(dst, '\\', 't')
			default:
				dst = append(dst, '\\', 'u', '0', '0', hexDigits[c>>4], hexDigits[c&0xF])
			}
			i++
			start = i
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			dst = append(dst, s[start:i]...)
			dst = append(dst, "�"...)
			i += size
			start = i
			continue
		}
		i += size
	}
	dst = append(dst, s[start:]...)
	return append(dst, '"')
}

// AppendNumber appends f formatted like JavaScript's Number#toString, the
// form JSON.stringify uses. Non-finite numbers become null.
func AppendNumber(dst []byte, f float64) []byte {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return append(dst, "null"...)
	}
	if f == 0 {
		return append(dst, '0')
	}
	if f == math.Trunc(f) && math.Abs(f) < 1e21 {
		if math.Abs(f) < 1<<53 {
			return strconv.AppendInt(dst, int64(f), 10)
		}
		return strconv.AppendFloat(dst, f, 'f', -1, 64)
	}
	var scratch [32]byte
	e := strconv.AppendFloat(scratch[:0], f, 'e', -1, 64)
	neg := e[0] == '-'
	if neg {
		e = e[1:]
		dst = append(dst, '-')
	}
	// e is now d[.ddd]e±XX
	var digits [24]byte
	k := 0
	j := 0
	for ; j < len(e) && e[j] != 'e'; j++ {
		if e[j] != '.' {
			digits[k] = e[j]
			k++
		}
	}
	exp, _ := strconv.Atoi(string(e[j+1:]))
	n := exp + 1
	ds := digits[:k]
	switch {
	case k <= n && n <= 21:
		dst = append(dst, ds...)
		for i := 0; i < n-k; i++ {
			dst = append(dst, '0')
		}
	case 0 < n && n <= 21:
		dst = append(dst, ds[:n]...)
		dst = append(dst, '.')
		dst = append(dst, ds[n:]...)
	case -6 < n && n <= 0:
		dst = append(dst, '0', '.')
		for i := 0; i < -n; i++ {
			dst = append(dst, '0')
		}
		dst = append(dst, ds...)
	default:
		dst = append(dst, ds[0])
		if k > 1 {
			dst = append(dst, '.')
			dst = append(dst, ds[1:]...)
		}
		dst = append(dst, 'e')
		if n-1 >= 0 {
			dst = append(dst, '+')
		}
		dst = strconv.AppendInt(dst, int64(n-1), 10)
	}
	return dst
}

// Compact returns the JSON.stringify(JSON.parse(s)) form of s, or s itself
// when s is not valid JSON.
func Compact(s string) string {
	v, err := Parse(s)
	if err != nil {
		return s
	}
	return Stringify(v)
}

// LooksLikeJSON reports whether the trimmed string starts and ends like an
// object or an array.
func LooksLikeJSON(s string) bool {
	i, j := 0, len(s)
	for i < j && isJSSpace(s[i]) {
		i++
	}
	for j > i && isJSSpace(s[j-1]) {
		j--
	}
	if j-i < 2 {
		return false
	}
	return (s[i] == '{' && s[j-1] == '}') || (s[i] == '[' && s[j-1] == ']')
}

func isJSSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f'
}

// MaxDepth is the deepest nesting Parse accepts.
const MaxDepth = maxDepth

// Scanner reads a JSON document piece by piece with the grammar of Parse,
// for callers that transcode it without building the value tree.
type Scanner struct{ p parser }

// NewScanner returns a scanner at the start of s.
func NewScanner(s string) *Scanner { return &Scanner{p: parser{s: s}} }

// SkipSpace skips whitespace.
func (sc *Scanner) SkipSpace() { sc.p.skipSpace() }

// Peek returns the next byte, without skipping whitespace.
func (sc *Scanner) Peek() (byte, bool) {
	if sc.p.i >= len(sc.p.s) {
		return 0, false
	}
	return sc.p.s[sc.p.i], true
}

// Next consumes one byte.
func (sc *Scanner) Next() { sc.p.i++ }

// Offset is the read position; SetOffset rewinds to one.
func (sc *Scanner) Offset() int     { return sc.p.i }
func (sc *Scanner) SetOffset(i int) { sc.p.i = i }

// String reads a string literal.
func (sc *Scanner) String() (string, error) { return sc.p.str() }

// Number reads a number.
func (sc *Scanner) Number() (float64, error) { return sc.p.number() }

// Literal reads true, false or null.
func (sc *Scanner) Literal() (any, error) {
	switch c, _ := sc.Peek(); c {
	case 't':
		return sc.p.literal("true", true)
	case 'f':
		return sc.p.literal("false", false)
	case 'n':
		return sc.p.literal("null", nil)
	}
	return nil, errSyntax
}

// Value parses the next value, at the given nesting depth, into a tree.
func (sc *Scanner) Value(depth int) (any, error) { return sc.p.value(depth) }

// Done reports whether only whitespace is left.
func (sc *Scanner) Done() bool {
	sc.p.skipSpace()
	return sc.p.i == len(sc.p.s)
}

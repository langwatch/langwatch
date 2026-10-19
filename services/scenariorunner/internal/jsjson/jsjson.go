// Package jsjson reads and writes JSON the way JavaScript's JSON.parse and
// JSON.stringify do: object keys keep their order, numbers print as JS
// numbers and strings escape only what JSON.stringify escapes. The Node
// scenario child builds request bodies and agent replies with those two
// functions, so the Go runner needs the same bytes.
package jsjson

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Object is a JSON object with its keys in insertion order.
type Object struct {
	keys   []string
	values map[string]any
}

// NewObject returns an empty object.
func NewObject() *Object { return &Object{values: map[string]any{}} }

// Set adds or replaces a key; a replaced key keeps its first position, as in JS.
func (o *Object) Set(key string, value any) *Object {
	if _, ok := o.values[key]; !ok {
		o.keys = append(o.keys, key)
	}
	o.values[key] = value
	return o
}

// Get returns the value at key.
func (o *Object) Get(key string) (any, bool) {
	if o == nil {
		return nil, false
	}
	v, ok := o.values[key]
	return v, ok
}

// Has reports whether key is present.
func (o *Object) Has(key string) bool {
	_, ok := o.Get(key)
	return ok
}

// Delete removes a key.
func (o *Object) Delete(key string) {
	if _, ok := o.values[key]; !ok {
		return
	}
	delete(o.values, key)
	for i, k := range o.keys {
		if k == key {
			o.keys = append(o.keys[:i], o.keys[i+1:]...)
			return
		}
	}
}

// Keys returns the keys in order.
func (o *Object) Keys() []string {
	if o == nil {
		return nil
	}
	return append([]string(nil), o.keys...)
}

// Len is the number of keys.
func (o *Object) Len() int {
	if o == nil {
		return 0
	}
	return len(o.keys)
}

// Raw is JSON text written verbatim by Stringify.
type Raw string

// Undefined is a value JSON.stringify leaves out of an object.
type Undefined struct{}

// Parse decodes JSON into nil, bool, float64, string, []any and *Object.
func Parse(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	v, err := parseValue(dec)
	if err != nil {
		return nil, err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, errors.New("unexpected data after the JSON value")
	}
	return v, nil
}

func parseValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		if t == '{' {
			return parseObject(dec)
		}
		if t == '[' {
			return parseArray(dec)
		}
		return nil, fmt.Errorf("unexpected delimiter %q", t)
	case json.Number:
		return parseNumber(t)
	default:
		return t, nil
	}
}

func parseObject(dec *json.Decoder) (any, error) {
	obj := NewObject()
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		key, _ := keyTok.(string)
		val, err := parseValue(dec)
		if err != nil {
			return nil, err
		}
		obj.Set(key, val)
	}
	_, err := dec.Token()
	return obj, err
}

func parseArray(dec *json.Decoder) (any, error) {
	arr := []any{}
	for dec.More() {
		val, err := parseValue(dec)
		if err != nil {
			return nil, err
		}
		arr = append(arr, val)
	}
	_, err := dec.Token()
	return arr, err
}

func parseNumber(n json.Number) (any, error) {
	f, err := strconv.ParseFloat(string(n), 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return nil, err
	}
	return f, nil
}

// Stringify encodes v as JSON.stringify would. Supported values are nil,
// bool, numbers, string, Raw, []any, []string, *Object and map[string]any
// (keys sorted, as Go maps have no order).
func Stringify(v any) string {
	return string(Append(nil, v))
}

// Append appends the encoding of v to b.
func Append(b []byte, v any) []byte {
	if out, ok := appendScalar(b, v); ok {
		return out
	}
	switch t := v.(type) {
	case []any:
		return appendArray(b, len(t), func(b []byte, i int) []byte { return Append(b, t[i]) })
	case []string:
		return appendArray(b, len(t), func(b []byte, i int) []byte { return AppendString(b, t[i]) })
	case *Object:
		return appendObject(b, t)
	case map[string]any:
		return appendObject(b, sortedObject(t))
	case map[string]string:
		m := make(map[string]any, len(t))
		for k, v := range t {
			m[k] = v
		}
		return appendObject(b, sortedObject(m))
	}
	return AppendString(b, fmt.Sprint(v))
}

func appendScalar(b []byte, v any) ([]byte, bool) {
	switch t := v.(type) {
	case nil, Undefined:
		return append(b, "null"...), true
	case bool:
		return strconv.AppendBool(b, t), true
	case string:
		return AppendString(b, t), true
	case Raw:
		return append(b, t...), true
	case json.RawMessage:
		return append(b, t...), true
	case float64:
		return AppendNumber(b, t), true
	case float32:
		return AppendNumber(b, float64(t)), true
	case int:
		return strconv.AppendInt(b, int64(t), 10), true
	case int64:
		return strconv.AppendInt(b, t, 10), true
	case json.Number:
		f, _ := strconv.ParseFloat(string(t), 64)
		return AppendNumber(b, f), true
	}
	return b, false
}

func appendArray(b []byte, n int, elem func([]byte, int) []byte) []byte {
	b = append(b, '[')
	for i := range n {
		if i > 0 {
			b = append(b, ',')
		}
		b = elem(b, i)
	}
	return append(b, ']')
}

func appendObject(b []byte, o *Object) []byte {
	b = append(b, '{')
	n := 0
	for _, k := range o.keys {
		val := o.values[k]
		if _, skip := val.(Undefined); skip {
			continue
		}
		if n > 0 {
			b = append(b, ',')
		}
		n++
		b = AppendString(b, k)
		b = append(b, ':')
		b = Append(b, val)
	}
	return append(b, '}')
}

// sortedObject orders a Go map by key, as it has no order of its own.
func sortedObject(m map[string]any) *Object {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	obj := NewObject()
	for _, k := range keys {
		obj.Set(k, m[k])
	}
	return obj
}

// AppendNumber appends a number as JS prints it; NaN and infinities are null.
func AppendNumber(b []byte, f float64) []byte {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return append(b, "null"...)
	}
	if f == 0 {
		return append(b, '0')
	}
	abs := math.Abs(f)
	if abs >= 1e21 || abs < 1e-6 {
		s := strconv.FormatFloat(f, 'e', -1, 64)
		mantissa, exp, _ := strings.Cut(s, "e")
		sign := exp[0]
		digits := strings.TrimLeft(exp[1:], "0")
		return append(b, mantissa+"e"+string(sign)+digits...)
	}
	return strconv.AppendFloat(b, f, 'f', -1, 64)
}

const hexDigits = "0123456789abcdef"

// shortEscapes are the control characters JSON.stringify writes as two characters.
var shortEscapes = map[byte]string{'"': `\"`, '\\': `\\`, '\b': `\b`, '\f': `\f`, '\n': `\n`, '\r': `\r`, '\t': `\t`}

// AppendString appends a JSON string literal escaped as JSON.stringify does.
func AppendString(b []byte, s string) []byte {
	b = append(b, '"')
	for i := 0; i < len(s); {
		if c := s[i]; c < utf8.RuneSelf {
			b = appendASCII(b, c)
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			b = append(b, `\ufffd`...)
		} else {
			b = append(b, s[i:i+size]...)
		}
		i += size
	}
	return append(b, '"')
}

func appendASCII(b []byte, c byte) []byte {
	if esc, ok := shortEscapes[c]; ok {
		return append(b, esc...)
	}
	if c < 0x20 {
		return append(b, '\\', 'u', '0', '0', hexDigits[c>>4], hexDigits[c&0xf])
	}
	return append(b, c)
}

// ToText is how the Node child turns a value into reply text: a string as it
// is, anything else through JSON.stringify.
func ToText(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return Stringify(v)
}

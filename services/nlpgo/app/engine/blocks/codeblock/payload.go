package codeblock

import (
	"encoding/json"
	"reflect"
	"strconv"
	"unicode/utf8"
)

// requestFits reports whether req's encoded request stays within limit bytes.
// It walks the values instead of encoding them: escaping can grow a string
// sixfold, so encoding first would allocate the oversized payload it refuses.
func requestFits(req Request, limit int) bool {
	budget := sizeBudget{left: limit}
	budget.value(reflect.ValueOf(req.Code), 0)
	budget.value(reflect.ValueOf(req.Inputs), 0)
	budget.value(reflect.ValueOf(req.DeclaredOutputs), 0)
	budget.value(reflect.ValueOf(req.Secrets), 0)
	budget.value(reflect.ValueOf(req.Params), 0)
	return budget.left >= 0
}

// maxEncodedDepth refuses values nested past what encoding/json would walk sensibly.
const maxEncodedDepth = 128

// sizeBudget counts an upper bound of encoded bytes down from left; below zero
// means over, and the walk stops spending effort.
type sizeBudget struct{ left int }

func (b *sizeBudget) spend(n int) {
	b.left -= n
}

func (b *sizeBudget) value(v reflect.Value, depth int) {
	if b.left < 0 {
		return
	}
	if depth > maxEncodedDepth {
		b.left = -1
		return
	}
	switch v.Kind() {
	case reflect.Invalid:
		b.spend(len("null"))
	case reflect.Interface, reflect.Pointer:
		if v.IsNil() {
			b.spend(len("null"))
			return
		}
		b.value(v.Elem(), depth+1)
	case reflect.String:
		b.spend(encodedStringSize(v.String()))
	case reflect.Bool, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr,
		reflect.Float32, reflect.Float64:
		b.spend(32)
	case reflect.Map:
		b.mapValue(v, depth)
	case reflect.Slice, reflect.Array:
		b.listValue(v, depth)
	default:
		b.leaf(v)
	}
}

func (b *sizeBudget) mapValue(v reflect.Value, depth int) {
	if v.IsNil() {
		b.spend(len("null"))
		return
	}
	b.spend(2)
	for it := v.MapRange(); it.Next() && b.left >= 0; {
		key := it.Key()
		if key.Kind() == reflect.String {
			b.spend(encodedStringSize(key.String()) + 2)
		} else {
			b.spend(len(strconv.Quote(key.String())) + 34)
		}
		b.value(it.Value(), depth+1)
	}
}

func (b *sizeBudget) listValue(v reflect.Value, depth int) {
	if v.Kind() == reflect.Slice && v.IsNil() {
		b.spend(len("null"))
		return
	}
	if v.Type().Elem().Kind() == reflect.Uint8 {
		b.spend(v.Len()*4/3 + 4)
		return
	}
	b.spend(2)
	for i := 0; i < v.Len() && b.left >= 0; i++ {
		b.spend(1)
		b.value(v.Index(i), depth+1)
	}
}

// leaf sizes a value the walk does not know by encoding it alone; such values
// (structs, json.Number) never carry the customer's bulk data.
func (b *sizeBudget) leaf(v reflect.Value) {
	if !v.CanInterface() {
		b.left = -1
		return
	}
	data, err := json.Marshal(v.Interface())
	if err != nil {
		b.left = -1
		return
	}
	b.spend(len(data))
}

// encodedStringSize is the length encoding/json gives s: quotes, two-byte
// escapes, \u00XX for control and HTML characters, and � for bad UTF-8.
func encodedStringSize(s string) int {
	n := 2
	for i := 0; i < len(s); {
		if s[i] < utf8.RuneSelf {
			n += asciiEncodedSize(s[i])
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if (r == utf8.RuneError && size == 1) || r == '\u2028' || r == '\u2029' {
			n += 6
		} else {
			n += size
		}
		i += size
	}
	return n
}

// asciiEncodedSize is the length encoding/json gives one ASCII byte.
func asciiEncodedSize(c byte) int {
	switch {
	case c == '"' || c == '\\' || c == '\n' || c == '\r' || c == '\t':
		return 2
	case c < 0x20 || c == '<' || c == '>' || c == '&':
		return 6
	default:
		return 1
	}
}

package devscripts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// Member is one key of an Object, which keeps the order the file wrote.
type Member struct {
	Key   string
	Value any
}

// Object is a JSON object that remembers key order, as a JS object does.
type Object []Member

// Set replaces the value of key in place, or appends it, as `obj[key] = v`.
func (o Object) Set(key string, value any) Object {
	for i := range o {
		if o[i].Key == key {
			o[i].Value = value
			return o
		}
	}
	return append(o, Member{Key: key, Value: value})
}

func parseOrdered(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	return decodeOrdered(dec)
}

func decodeOrdered(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	delim, ok := tok.(json.Delim)
	if !ok {
		return tok, nil
	}
	if delim == '[' {
		return decodeOrderedArray(dec)
	}
	return decodeOrderedObject(dec)
}

func decodeOrderedArray(dec *json.Decoder) (any, error) {
	list := []any{}
	for dec.More() {
		item, err := decodeOrdered(dec)
		if err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	_, err := dec.Token()
	return list, err
}

func decodeOrderedObject(dec *json.Decoder) (any, error) {
	object := Object{}
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return nil, err
		}
		value, err := decodeOrdered(dec)
		if err != nil {
			return nil, err
		}
		object = append(object, Member{Key: key.(string), Value: value})
	}
	_, err := dec.Token()
	return object, err
}

// stringifyJS is JSON.stringify(value, undefined, 2) for the value shapes
// above; numbers keep their source text, where JS would renormalise them.
func stringifyJS(value any) string {
	var sb strings.Builder
	writeJS(&sb, value, "")
	return sb.String()
}

func writeJS(sb *strings.Builder, value any, indent string) {
	switch v := value.(type) {
	case nil:
		sb.WriteString("null")
	case bool:
		fmt.Fprintf(sb, "%t", v)
	case string:
		sb.WriteString(jsQuote(v))
	case json.Number:
		sb.WriteString(v.String())
	case int:
		fmt.Fprintf(sb, "%d", v)
	case []any:
		writeJSArray(sb, v, indent)
	case Object:
		writeJSObject(sb, v, indent)
	default:
		panic(fmt.Sprintf("stringifyJS: unsupported %T", value))
	}
}

func writeJSArray(sb *strings.Builder, items []any, indent string) {
	if len(items) == 0 {
		sb.WriteString("[]")
		return
	}
	inner := indent + "  "
	sb.WriteString("[\n")
	for i, item := range items {
		sb.WriteString(inner)
		writeJS(sb, item, inner)
		sb.WriteString(separator(i, len(items)))
	}
	sb.WriteString(indent + "]")
}

func writeJSObject(sb *strings.Builder, object Object, indent string) {
	if len(object) == 0 {
		sb.WriteString("{}")
		return
	}
	inner := indent + "  "
	sb.WriteString("{\n")
	for i, member := range object {
		sb.WriteString(inner + jsQuote(member.Key) + ": ")
		writeJS(sb, member.Value, inner)
		sb.WriteString(separator(i, len(object)))
	}
	sb.WriteString(indent + "}")
}

func separator(i, n int) string {
	if i < n-1 {
		return ",\n"
	}
	return "\n"
}

// jsQuote is JSON.stringify for a string: no HTML escaping, lowercase \u00xx.
func jsQuote(s string) string {
	var sb strings.Builder
	sb.WriteByte('"')
	for _, r := range s {
		switch {
		case r == '"':
			sb.WriteString(`\"`)
		case r == '\\':
			sb.WriteString(`\\`)
		case r == '\b':
			sb.WriteString(`\b`)
		case r == '\f':
			sb.WriteString(`\f`)
		case r == '\n':
			sb.WriteString(`\n`)
		case r == '\r':
			sb.WriteString(`\r`)
		case r == '\t':
			sb.WriteString(`\t`)
		case r < 0x20:
			fmt.Fprintf(&sb, `\u%04x`, r)
		default:
			sb.WriteRune(r)
		}
	}
	sb.WriteByte('"')
	return sb.String()
}

// Package httpblock implements the HTTP block executor: render a body
// template, apply auth, send the request, extract a value from the
// JSON response. SSRF protection mirrors the Python http_node parity.
package httpblock

import (
	"encoding/json"
	"fmt"
	"strings"
)

// RenderTemplate replaces {{ variable.path }} placeholders in template
// using the inputs map. It mirrors the Python interpolate_template:
// string values are JSON-escaped without outer quotes (so they can be
// embedded inside JSON strings safely), and non-string values are
// JSON-stringified directly.
//
// Supported syntax (intentionally a subset of Liquid):
//   {{ x }}                 — top-level key
//   {{ x.y.z }}             — dotted path into nested map
//   {{ x[0] }}              — numeric index into a slice
//   {{  x.y  }}             — leading/trailing whitespace tolerated
//
// Missing variables render as empty string (with a warning emitted by
// the executor, not by this function).
func RenderTemplate(template string, inputs map[string]any) (string, []string) {
	var warnings []string
	var b strings.Builder
	b.Grow(len(template))
	i := 0
	for i < len(template) {
		j := strings.Index(template[i:], "{{")
		if j < 0 {
			b.WriteString(template[i:])
			break
		}
		b.WriteString(template[i : i+j])
		end := strings.Index(template[i+j:], "}}")
		if end < 0 {
			// Unclosed tag — emit verbatim and stop.
			b.WriteString(template[i+j:])
			break
		}
		expr := strings.TrimSpace(template[i+j+2 : i+j+end])
		val, ok := lookupPath(inputs, expr)
		if !ok {
			warnings = append(warnings, "template variable not found: "+expr)
			// Empty render keeps positional structure.
		} else {
			b.WriteString(formatValue(val))
		}
		i = i + j + end + 2
	}
	return b.String(), warnings
}

// formatValue mirrors the Python encoding rule:
//   - strings → json.Marshal then strip the outer quotes
//   - everything else → json.Marshal whole
func formatValue(v any) string {
	if s, ok := v.(string); ok {
		// json.Marshal of a string always returns "..." with the
		// outer quotes; stripping leaves a JSON-escaped body safe to
		// embed inside another JSON string literal.
		raw, _ := json.Marshal(s)
		if len(raw) >= 2 {
			return string(raw[1 : len(raw)-1])
		}
		return ""
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(raw)
}

// lookupPath walks a dotted/indexed path through nested maps and slices.
// Returns the final value and true on hit; (nil,false) on any miss.
func lookupPath(root map[string]any, path string) (any, bool) {
	if path == "" {
		return nil, false
	}
	tokens := tokenize(path)
	var cur any = root
	for _, tok := range tokens {
		switch v := cur.(type) {
		case map[string]any:
			next, ok := v[tok.name]
			if !ok {
				return nil, false
			}
			if tok.index >= 0 {
				cur = nthOf(next, tok.index)
				if cur == nil {
					return nil, false
				}
			} else {
				cur = next
			}
		case []any:
			if tok.name != "" {
				return nil, false
			}
			cur = nthOf(v, tok.index)
			if cur == nil {
				return nil, false
			}
		default:
			return nil, false
		}
	}
	return cur, true
}

type pathToken struct {
	name  string
	index int // -1 if absent
}

func tokenize(path string) []pathToken {
	var out []pathToken
	for _, segment := range strings.Split(path, ".") {
		// Look for [N] suffixes in this segment.
		idx := -1
		name := segment
		if br := strings.Index(segment, "["); br >= 0 {
			name = segment[:br]
			rest := segment[br+1:]
			if cl := strings.Index(rest, "]"); cl >= 0 {
				var n int
				if _, err := fmt.Sscanf(rest[:cl], "%d", &n); err == nil {
					idx = n
				}
			}
		}
		out = append(out, pathToken{name: name, index: idx})
	}
	return out
}

func nthOf(v any, i int) any {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	if i < 0 || i >= len(arr) {
		return nil
	}
	return arr[i]
}

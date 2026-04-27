// Package template renders a small Liquid-subset template against a
// map of inputs. Used by the HTTP block (body templates) and the
// signature/LLM block (instructions + user prompts) so all three
// places interpolate variables consistently.
//
// This is intentionally a subset of full Liquid — no loops, no
// conditionals, no filters. Just `{{ var }}`, `{{ x.y.z }}` dotted
// paths, and `{{ x[0] }}` numeric indexing. Mirrors the Python
// `interpolate_template` shape (langwatch_nlp/.../http_node.py) and
// is a strict subset of what `liquid.render` accepts in
// `langwatch_nlp/.../template_adapter.py`. Anything more elaborate
// from a customer template renders as the literal expression with a
// warning, so callers can detect un-supported syntax and fall back if
// needed.
package template

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// Render replaces {{ variable.path }} placeholders in template using
// the inputs map. String values are JSON-escaped without outer quotes
// (so they can be safely embedded inside JSON string literals);
// non-string values are JSON-stringified.
//
// Returns the rendered string and a list of variable names that were
// referenced but not found. The expected use is "render and emit any
// warnings to a structured log"; callers decide whether missing-var
// is fatal.
func Render(tmpl string, inputs map[string]any) (string, []string) {
	var warnings []string
	var b strings.Builder
	b.Grow(len(tmpl))
	i := 0
	for i < len(tmpl) {
		j := strings.Index(tmpl[i:], "{{")
		if j < 0 {
			b.WriteString(tmpl[i:])
			break
		}
		b.WriteString(tmpl[i : i+j])
		end := strings.Index(tmpl[i+j:], "}}")
		if end < 0 {
			// Unclosed tag — emit verbatim and stop.
			b.WriteString(tmpl[i+j:])
			break
		}
		expr := strings.TrimSpace(tmpl[i+j+2 : i+j+end])
		val, ok := lookupPath(inputs, expr)
		if !ok {
			warnings = append(warnings, "template variable not found: "+expr)
		} else {
			b.WriteString(formatValue(val))
		}
		i = i + j + end + 2
	}
	return b.String(), warnings
}

func formatValue(v any) string {
	if s, ok := v.(string); ok {
		raw := encodeJSONNoHTMLEscape(s)
		// Strip the outer quotes the JSON encoder added — callers
		// embed the result inside an existing string context (system
		// prompt or HTTP body literal). Inner JSON-special chars (",
		// \, control chars) stay escaped.
		if len(raw) >= 2 {
			return string(raw[1 : len(raw)-1])
		}
		return ""
	}
	raw := encodeJSONNoHTMLEscape(v)
	return string(raw)
}

// encodeJSONNoHTMLEscape mirrors `json.Marshal` but with HTML-escape
// disabled — `<`, `>`, `&` survive verbatim, matching Python's
// `json.dumps(..., ensure_ascii=False)` behavior. Pins the parity
// claim from langwatch_nlp regression e8db9a51e (UTF-8 encoding) for
// the punctuation half of that fix's intent. The ASCII default in
// Go's encoding/json already preserves emoji + non-ASCII unicode
// verbatim, so no additional handling is needed there.
func encodeJSONNoHTMLEscape(v any) []byte {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return []byte(fmt.Sprintf("%v", v))
	}
	out := buf.Bytes()
	// json.Encoder appends a trailing newline that json.Marshal does
	// not — strip it so call sites see the same shape they always have.
	if len(out) > 0 && out[len(out)-1] == '\n' {
		out = out[:len(out)-1]
	}
	return out
}

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
	index int
}

func tokenize(path string) []pathToken {
	var out []pathToken
	for _, segment := range strings.Split(path, ".") {
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

// Package template renders templates against a map of inputs. Two
// public entry points:
//
//   - Render: a Liquid-subset interpolator used by the HTTP block. Just
//     `{{ var }}`, `{{ x.y.z }}` dotted paths, `{{ x[0] }}` indexing.
//     Output is JSON-escaped for embedding inside JSON literals (the
//     httpblock body context). HTML chars survive verbatim. Behavior
//     pinned by template_test.go since v0 of nlpgo and unchanged.
//
//   - RenderFull: full Liquid via github.com/osteele/liquid for the
//     LLM Call instructions path. Supports `{% for %}` / `{% if %}` /
//     filters / dotted paths / native list iteration. Mirrors Python's
//     `liquid.render(template, **rendered_inputs)` in
//     langwatch_nlp/.../template_adapter.py — DSPy templates with
//     control-flow tags now render correctly on the Go path
//     (previously the literal `{% for %}` survived in the output).
package template

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/osteele/liquid"
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

// liquidEngine is the singleton osteele/liquid engine used by RenderFull.
// Created lazily so package init stays lightweight.
var liquidEngine = liquid.NewEngine()

// liquidControlFlowOrFilterRE matches templates that use Liquid features
// beyond simple `{{ var }}` interpolation — `{% tag %}` blocks or
// `{{ var | filter }}` pipe filters. RenderFull uses this to short-
// circuit to the simple Render path when there is no Liquid-extended
// syntax in the template, preserving the existing JSON-escape semantics
// for templates that don't need full Liquid (the HTTP-block path
// covered by template_test.go).
var liquidControlFlowOrFilterRE = regexp.MustCompile(`(?s)({%.*?%})|({{[^{}]*\|[^{}]*}})`)

// RenderFull renders a template with full Liquid semantics
// (loops, conditionals, filters) when the template uses any
// Liquid-extended syntax; falls back to the simple Render path when
// it doesn't. Mirrors langwatch_nlp's `liquid.render` call in
// dspy/template_adapter.py — needed for DSPy templates that iterate
// over chat history (`{% for m in messages %}{{ m.content }}{% endfor %}`)
// or branch on input shape.
//
// Returns the rendered string and a list of warnings. Warnings include
// missing-variable references (so callers can log them) and any Liquid
// parse/render errors (returned as-is so operators see the bad syntax
// instead of silently emitting an empty string).
func RenderFull(tmpl string, inputs map[string]any) (string, []string) {
	if !liquidControlFlowOrFilterRE.MatchString(tmpl) {
		// No control flow / filters — fall back to the simple
		// interpolator so HTTP-block-style JSON-escape behavior stays
		// intact for `{{ var }}`-only templates.
		return Render(tmpl, inputs)
	}
	bindings := make(map[string]any, len(inputs))
	for k, v := range inputs {
		bindings[k] = coerceForLiquid(v)
	}
	out, err := liquidEngine.ParseAndRenderString(tmpl, bindings)
	if err != nil {
		// Surface the error as a warning rather than failing the run —
		// callers (engine.runSignature) already treat the rendered
		// string as best-effort and emit warnings to the log. A bad
		// template shouldn't hard-fail the whole workflow.
		return "", []string{fmt.Sprintf("liquid render error: %v", err)}
	}
	return out, nil
}

// coerceForLiquid prepares a template input for full-Liquid rendering.
// Mirrors langwatch_nlp's `_coerce_for_liquid` — strings that parse as
// JSON arrays/objects are parsed back into native Go containers so
// `{% for m in messages %}` works on values that arrived through the
// TS↔NLP wire as JSON-stringified.
func coerceForLiquid(value any) any {
	s, ok := value.(string)
	if !ok {
		return value
	}
	stripped := strings.TrimLeft(s, " \t\r\n")
	if stripped == "" {
		return value
	}
	switch stripped[0] {
	case '[', '{':
		var parsed any
		if err := json.Unmarshal([]byte(s), &parsed); err == nil {
			switch parsed.(type) {
			case []any, map[string]any:
				return parsed
			}
		}
	}
	return value
}

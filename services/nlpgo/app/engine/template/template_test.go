package template

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestRender_PreservesHTMLPunctuationInStringValues pins parity with
// Python's json.dumps(ensure_ascii=False) — see langwatch_nlp regression
// e8db9a51e ("set ensure_ascii as false on all json.dumps inside NLP
// to support utf-8 encoding"). Go's encoding/json by default HTML-escapes
// `<`, `>`, `&` to `<`, `>`, `&`; Python's json.dumps
// with ensure_ascii=False emits them raw. A customer with a snippet
// like `<div>` flowing through a `{{ snippet }}` placeholder must see
// the raw chars in the rendered system prompt — otherwise the LLM
// receives escaped pseudo-unicode and the prompt semantics shift.
func TestRender_PreservesHTMLPunctuationInStringValues(t *testing.T) {
	out, warns := Render("Snippet: {{ snippet }}", map[string]any{
		"snippet": "<code>tag & more</code>",
	})
	assert.Empty(t, warns)
	assert.Equal(t, "Snippet: <code>tag & more</code>", out,
		"HTML punctuation must survive verbatim — encoding/json HTML escape "+
			"is wrong for our use case (matches python json.dumps(ensure_ascii=False))")
}

// TestRender_PreservesHTMLPunctuationInNestedStructures covers the
// same parity claim when the input traverses a non-string container —
// formatValue on a struct/map/list goes through json.Marshal and would
// otherwise HTML-escape every nested string.
func TestRender_PreservesHTMLPunctuationInNestedStructures(t *testing.T) {
	out, _ := Render("Tags: {{ tags }}", map[string]any{
		"tags": []any{"<a>", "<b>", "&c"},
	})
	// The list itself is rendered as JSON (no dot-path), but the
	// individual string entries inside should not be HTML-escaped.
	assert.Contains(t, out, "<a>")
	assert.Contains(t, out, "<b>")
	assert.Contains(t, out, "&c")
	// Guard against the encoding/json default HTML-escape producing
	// 6-char \uXXXX sequences instead of the raw chars above.
	assert.NotContains(t, out, "\\u003c",
		"no escaped < should appear in rendered output")
	assert.NotContains(t, out, "\\u0026",
		"no escaped & should appear in rendered output")
}

// TestRender_PreservesNonASCIIUnicodeVerbatim covers the other half of
// the e8db9a51e parity intent: emoji, CJK, and accented characters
// must pass through as raw UTF-8, not as \uXXXX escape sequences.
// Go's encoding/json does this correctly by default for non-ASCII;
// this test pins the contract.
func TestRender_PreservesNonASCIIUnicodeVerbatim(t *testing.T) {
	cases := map[string]string{
		"emoji":    "🚀 launch",
		"chinese":  "你好世界",
		"accented": "café résumé naïve",
		"mixed":    "Hello 👋 世界",
	}
	for name, value := range cases {
		out, _ := Render("Echo: {{ x }}", map[string]any{"x": value})
		assert.Equal(t, "Echo: "+value, out, "case %q should round-trip verbatim", name)
		// And no escape leakage.
		assert.False(t, strings.Contains(out, `\u`),
			"case %q produced escape sequences in %q", name, out)
	}
}

// TestRender_QuotesAndBackslashesInStringValues guards the JSON-special
// chars that DO need escaping when the rendered output lands inside a
// JSON string context (httpblock body). Quote and backslash must
// survive in the output as their backslash-escaped form so the JSON
// parser the body feeds into doesn't choke. (formatValue strips the
// outer JSON quotes but keeps the inner escapes intact.)
func TestRender_QuotesAndBackslashesInStringValues(t *testing.T) {
	out, _ := Render(`{"q":"{{ q }}"}`, map[string]any{
		"q": `she said "hi" \ then`,
	})
	// Quote and backslash should appear in their escaped form so the
	// surrounding JSON literal stays valid.
	assert.Contains(t, out, `\"hi\"`,
		"double-quote inside string value must be JSON-escaped")
	assert.Contains(t, out, `\\`,
		"backslash inside string value must be JSON-escaped")
}

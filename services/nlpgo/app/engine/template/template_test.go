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

// TestRender_JSONValueDoesNotReinterpretBraces pins the parity contract
// derived from langwatch_nlp commit c6e2ede84 ("fix: dataset image
// column type + use liquid templates instead of low level python
// string template to avoid having issues with json interpolation").
//
// The Python regression: TemplateAdapter previously did
//
//	template_clean = re.sub(r"{{\s*(.*?)\s*}}", r"{{\1}}", template)
//	template_fmt = template_clean.replace("{{", "{").replace("}}", "}")
//	return template_fmt.format_map(SafeDict(str_inputs))
//
// — i.e. converted Liquid markers to Python format placeholders, then
// called .format_map(). When a customer's input value was a JSON
// object like {"name":"Alice"}, the literal `{` and `}` characters in
// the rendered value got re-interpreted by .format_map() as new format
// placeholders, producing KeyError or wrong output. The fix switched
// to liquid.render which treats values as opaque strings — single-pass
// replacement, no re-scanning of the rendered output.
//
// Go's `Render` is single-pass by construction. This pins the contract
// against a future "optimization" that re-scans the output (e.g. if
// someone introduces a multi-pass renderer for control-flow support
// later). Three sub-cases cover the concrete failure modes Python's
// bug produced.
func TestRender_JSONValueDoesNotReinterpretBraces(t *testing.T) {
	t.Run("plain JSON object value", func(t *testing.T) {
		// A profile object inserted into the system prompt — the
		// canonical c6e2ede84 shape. The JSON braces in the rendered
		// value must NOT be re-scanned for template markers.
		out, warnings := Render("Profile: {{ profile }}", map[string]any{
			"profile": map[string]any{"name": "Alice", "age": 30},
		})
		assert.Empty(t, warnings)
		assert.Contains(t, out, `"name":"Alice"`)
		assert.Contains(t, out, `"age":30`)
	})

	t.Run("value containing literal {{ }} markers is not re-interpreted", func(t *testing.T) {
		// Stress the regression: a string value containing literal
		// `{{ malicious }}` should NOT be re-evaluated as a template.
		// Single-pass renderers handle this naturally; double-pass
		// renderers (the Python bug) would try to look up the inner
		// var and either fail loudly or blow up with KeyError.
		out, warnings := Render("Echo: {{ payload }}", map[string]any{
			"payload": "user said: {{ secret_var }}",
		})
		// `secret_var` is NOT defined, so any double-pass renderer
		// would emit a warning for it. We must NOT see one.
		for _, w := range warnings {
			assert.NotContains(t, w, "secret_var",
				"a value containing {{ }} must NOT be re-rendered as a template")
		}
		assert.Contains(t, out, "{{ secret_var }}",
			"the literal {{ secret_var }} from the value must survive verbatim in the output")
	})

	t.Run("value containing only one brace doesn't break the tail", func(t *testing.T) {
		// Single { in a value (e.g. partial JSON, or curly-quote
		// transcription) shouldn't cause the renderer to think it's
		// looking at the start of a template marker.
		out, warnings := Render("Got: {{ snippet }} done.", map[string]any{
			"snippet": "{ partial",
		})
		assert.Empty(t, warnings)
		assert.True(t, strings.HasSuffix(out, "done."),
			"the literal trailing text after the marker must survive even when the value contains a stray brace; got %q", out)
	})
}

// TestRender_DotPathAndArrayIndex pins the basic Liquid-subset support
// (already exercised by build_messages_test.go end-to-end, but the
// renderer-level tests were missing — adding here so the contract is
// observable without spinning up the engine).
func TestRender_DotPathAndArrayIndex(t *testing.T) {
	out, warnings := Render(
		"Hello {{ user.name }}, item {{ items[0] }}, nested {{ outer.inner.leaf }}.",
		map[string]any{
			"user":  map[string]any{"name": "Bob"},
			"items": []any{"alpha", "beta"},
			"outer": map[string]any{"inner": map[string]any{"leaf": "L"}},
		},
	)
	assert.Empty(t, warnings)
	assert.Equal(t, "Hello Bob, item alpha, nested L.", out)
}

// TestRender_MissingVariableEmitsWarningButNotPanic pins the
// "render-and-warn" contract. Engine consumers rely on this — they log
// the warning and treat the missing slot as empty rather than
// crashing.
func TestRender_MissingVariableEmitsWarningButNotPanic(t *testing.T) {
	out, warnings := Render("Topic: {{ topic }}, missing: {{ ghost }}", map[string]any{
		"topic": "math",
	})
	if assert.Len(t, warnings, 1) {
		assert.Contains(t, warnings[0], "ghost")
	}
	assert.Contains(t, out, "Topic: math")
	assert.NotContains(t, out, "{{ ghost }}",
		"missing variable should be substituted with empty, not survive verbatim")
}

// TestRenderFull_FallsBackToSimpleRenderForVarOnly proves that
// templates without Liquid-extended syntax (`{% %}` tags or pipe
// filters) take the same path as Render — preserving the
// JSON-escape semantics that the HTTP block + signature happy path
// rely on, and that template_test.go pins case-by-case above.
func TestRenderFull_FallsBackToSimpleRenderForVarOnly(t *testing.T) {
	cases := []struct {
		name string
		tmpl string
		in   map[string]any
		want string
	}{
		{"plain string var", "Hi {{ name }}", map[string]any{"name": "Alice"}, "Hi Alice"},
		{"dotted path", "Got {{ user.name }}", map[string]any{"user": map[string]any{"name": "Bob"}}, "Got Bob"},
		{"object as JSON", "Profile: {{ profile }}", map[string]any{"profile": map[string]any{"k": "v"}}, `Profile: {"k":"v"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, warnings := RenderFull(tc.tmpl, tc.in)
			assert.Empty(t, warnings)
			assert.Equal(t, tc.want, out)
		})
	}
}

// TestRenderFull_LiquidForLoopIteratesNativeList pins the load-bearing
// new feature: DSPy templates with `{% for m in messages %}` over a
// chat-history list now render every message instead of leaving the
// literal `{% for %}` tag in the output. Mirrors Python's
// liquid.render(template, messages=[...]).
func TestRenderFull_LiquidForLoopIteratesNativeList(t *testing.T) {
	out, warnings := RenderFull(
		"{% for m in messages %}- {{ m.content }}\n{% endfor %}",
		map[string]any{
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
				map[string]any{"role": "assistant", "content": "hi back"},
			},
		},
	)
	assert.Empty(t, warnings)
	assert.Equal(t, "- hello\n- hi back\n", out)
}

// TestRenderFull_LiquidIfBranchesOnInputShape pins control-flow
// support — customers branching on whether an input is set was
// silently broken before (the literal `{% if x %}` survived in the
// rendered output and confused the LLM).
func TestRenderFull_LiquidIfBranchesOnInputShape(t *testing.T) {
	tmpl := "{% if context %}Context: {{ context }}{% else %}No context{% endif %}"
	withContext, _ := RenderFull(tmpl, map[string]any{"context": "RAG snippet"})
	assert.Equal(t, "Context: RAG snippet", withContext)
	withoutContext, _ := RenderFull(tmpl, map[string]any{})
	assert.Equal(t, "No context", withoutContext)
}

// TestRenderFull_LiquidPipeFilters covers the third Liquid feature
// surface — `{{ x | upcase }}`, `{{ x | downcase }}`, `{{ x | size }}`.
// Pre-fix these survived as literals; now they apply.
func TestRenderFull_LiquidPipeFilters(t *testing.T) {
	out, warnings := RenderFull(
		"{{ name | upcase }} ({{ tags | size }} tags)",
		map[string]any{
			"name": "alice",
			"tags": []any{"go", "liquid"},
		},
	)
	assert.Empty(t, warnings)
	assert.Equal(t, "ALICE (2 tags)", out)
}

// TestRenderFull_CoercesJSONStringToNativeForLiquid pins the parity
// detail from langwatch_nlp's _coerce_for_liquid: when a chat history
// arrives as a JSON-stringified value (TS↔NLP wire convention), we
// must JSON.parse it back into a native list so `{% for %}` works.
// Without this the loop would silently iterate over no rows.
func TestRenderFull_CoercesJSONStringToNativeForLiquid(t *testing.T) {
	out, warnings := RenderFull(
		"{% for m in messages %}{{ m.role }}={{ m.content }};{% endfor %}",
		map[string]any{
			"messages": `[{"role":"user","content":"q"},{"role":"assistant","content":"a"}]`,
		},
	)
	assert.Empty(t, warnings)
	assert.Equal(t, "user=q;assistant=a;", out)
}

// TestRenderFull_BadTemplateSurfacesAsWarningNotPanic pins the
// fault-tolerance contract — a malformed template should NOT crash
// the workflow run; the engine surfaces the parse error as a warning
// so operators see the bad syntax in the trace log.
func TestRenderFull_BadTemplateSurfacesAsWarningNotPanic(t *testing.T) {
	_, warnings := RenderFull("{% for m in xs %}no end tag", map[string]any{"xs": []any{1}})
	if assert.Len(t, warnings, 1) {
		assert.Contains(t, warnings[0], "liquid")
	}
}

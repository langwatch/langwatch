// HTTP-block template rendering delegates to the shared engine
// template package so the same Liquid subset is used here, in the
// signature/LLM block, and anywhere else the engine needs to
// interpolate variables. Kept as a wrapper so existing call sites
// (executor.go, tests) don't have to change.
package httpblock

import "github.com/langwatch/langwatch/services/nlpgo/app/engine/template"

// RenderTemplate is a thin re-export of template.Render. See that
// package for the supported syntax.
func RenderTemplate(tmpl string, inputs map[string]any) (string, []string) {
	return template.Render(tmpl, inputs)
}

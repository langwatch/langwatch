package template

import (
	"fmt"
	"regexp"
	"strings"
)

// conditionIdentifierRE extracts (possibly dotted) identifiers from a
// Liquid boolean expression so EvaluateCondition can reject references
// to inputs the node doesn't have. Liquid itself treats unknown
// variables as nil, which silently flips comparisons like
// `context != ""` to true — a footgun for a gating condition, so we
// fail loudly instead.
var conditionIdentifierRE = regexp.MustCompile(`[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*`)

// liquidConditionKeywords are operators/literals valid inside a Liquid
// `{% if %}` expression that must not be mistaken for input references.
var liquidConditionKeywords = map[string]struct{}{
	"and": {}, "or": {}, "not": {}, "contains": {},
	"true": {}, "false": {}, "nil": {}, "null": {},
	"empty": {}, "blank": {},
}

// EvaluateCondition evaluates a Liquid boolean expression (the body of
// an `{% if … %}` tag) against the given inputs. Unlike RenderFull,
// errors are returned instead of demoted to warnings: a broken gating
// condition must fail the if/else node, not silently route the
// workflow.
func EvaluateCondition(condition string, inputs map[string]any) (bool, error) {
	trimmed := strings.TrimSpace(condition)
	if trimmed == "" {
		return false, fmt.Errorf("condition is empty")
	}

	for _, token := range conditionIdentifierRE.FindAllString(stripStringLiterals(trimmed), -1) {
		if _, keyword := liquidConditionKeywords[token]; keyword {
			continue
		}
		// Dotted access (`payload.kind`) resolves on the root key.
		root := strings.SplitN(token, ".", 2)[0]
		if _, ok := inputs[root]; !ok {
			return false, fmt.Errorf("condition references undefined input %q", root)
		}
	}

	bindings := make(map[string]any, len(inputs))
	for k, v := range inputs {
		bindings[k] = coerceForLiquid(v)
	}
	out, err := liquidEngine.ParseAndRenderString(
		"{% if "+trimmed+" %}1{% endif %}",
		bindings,
	)
	if err != nil {
		return false, fmt.Errorf("invalid condition: %w", err)
	}
	return strings.TrimSpace(out) != "", nil
}

// stripStringLiterals blanks out quoted strings so words inside them
// (`label == "not relevant"`) don't register as input references.
func stripStringLiterals(s string) string {
	var b strings.Builder
	inQuote := byte(0)
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case inQuote != 0:
			if c == inQuote {
				inQuote = 0
			}
			b.WriteByte(' ')
		case c == '\'' || c == '"':
			inQuote = c
			b.WriteByte(' ')
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

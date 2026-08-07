// Package semantictokens fails a build when a raw Chakra palette shade reaches
// a color prop in the app's source.
//
// The app defines its palette once, as semantic tokens: fg / fg.muted /
// fg.subtle, bg.panel / bg.subtle / bg.muted / bg.emphasized, border and
// friends, plus solid / subtle / muted / emphasized / fg on every hue. Each
// token carries a light value and a dark value. A raw shade — color="gray.500",
// borderColor="red.700" — carries only one, so it reads correctly in the mode it
// was written in and then fails in the other. That is not a style preference:
// dark text on a dark panel is unreadable.
//
// Spec: specs/ci/semantic-color-tokens.feature
package semantictokens

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Finding is one raw shade that should have been a token.
type Finding struct {
	File       string `json:"file"`
	Line       int    `json:"line"`
	Prop       string `json:"prop"`
	Raw        string `json:"raw"`
	Suggestion string `json:"suggestion"`
}

func (f Finding) String() string {
	return fmt.Sprintf("%s:%d  %s=%q  ->  %q", f.File, f.Line, f.Prop, f.Raw, f.Suggestion)
}

const hues = `blue|green|red|orange|purple|teal|yellow|cyan|pink`

// Props whose value Chakra resolves through the color token layer.
const props = `color|bg|bgColor|background|backgroundColor|borderColor` +
	`|borderTopColor|borderBottomColor|borderLeftColor|borderRightColor` +
	`|outlineColor|fill|stroke`

var (
	// prop="gray.500"
	attrRe = regexp.MustCompile(`\b(` + props + `)="((?:gray|` + hues + `)\.[0-9]{2,3})"`)
	// prop={cond ? "blue.500" : ...} and bg: "gray.50" inside a style object.
	exprRe = regexp.MustCompile(`\b(` + props + `)=\{[^{}]*"((?:gray|` + hues + `)\.[0-9]{2,3})"`)
	keyRe  = regexp.MustCompile(`\b(` + props + `):\s*"((?:gray|` + hues + `)\.[0-9]{2,3})"`)
)

// Which ladder a prop reads from: text, border or surface.
func kindOf(prop string) string {
	switch prop {
	case "color", "fill", "stroke":
		return "fg"
	case "borderColor", "borderTopColor", "borderBottomColor",
		"borderLeftColor", "borderRightColor", "outlineColor":
		return "border"
	default:
		return "bg"
	}
}

var (
	grayFg     = map[string]string{"950": "fg", "900": "fg", "800": "fg", "700": "fg.muted", "600": "fg.muted", "500": "fg.subtle", "400": "fg.subtle", "300": "fg.subtle"}
	grayBg     = map[string]string{"50": "bg.subtle", "100": "bg.muted", "200": "bg.emphasized", "300": "bg.emphasized"}
	grayBorder = map[string]string{"50": "border.subtle", "100": "border.muted", "200": "border", "300": "border.emphasized", "400": "border.emphasized", "500": "border.emphasized"}
	hueFg      = map[string]string{"900": "fg", "800": "fg", "700": "fg", "600": "fg", "500": "solid", "400": "solid", "300": "solid"}
	hueBg      = map[string]string{"50": "subtle", "100": "muted", "200": "muted", "300": "muted", "400": "solid", "500": "solid", "600": "solid"}
	hueBorder  = map[string]string{"50": "subtle", "100": "muted", "200": "muted", "300": "emphasized", "400": "emphasized", "500": "emphasized", "600": "emphasized"}
)

// Suggest returns the token that carries the same light value as raw, so the
// fix is a swap rather than a redesign. Empty when the shade has no counterpart
// and the author has to choose.
func Suggest(prop, raw string) string {
	hue, shade, ok := strings.Cut(raw, ".")
	if !ok {
		return ""
	}
	kind := kindOf(prop)
	if hue == "gray" {
		switch kind {
		case "fg":
			return grayFg[shade]
		case "border":
			return grayBorder[shade]
		default:
			return grayBg[shade]
		}
	}
	var sub string
	switch kind {
	case "fg":
		sub = hueFg[shade]
	case "border":
		sub = hueBorder[shade]
	default:
		sub = hueBg[shade]
	}
	if sub == "" {
		return ""
	}
	return hue + "." + sub
}

// ScanSource reports every raw shade in one file's contents. Pure: the caller
// supplies the text, so the rules are testable without a filesystem.
func ScanSource(path, src string) []Finding {
	var out []Finding
	seen := map[string]bool{}
	for _, re := range []*regexp.Regexp{attrRe, exprRe, keyRe} {
		for _, loc := range re.FindAllStringSubmatchIndex(src, -1) {
			prop := src[loc[2]:loc[3]]
			raw := src[loc[4]:loc[5]]
			line := 1 + strings.Count(src[:loc[0]], "\n")
			key := fmt.Sprintf("%d:%s:%s", line, prop, raw)
			if seen[key] {
				continue
			}
			seen[key] = true
			suggestion := Suggest(prop, raw)
			if suggestion == "" {
				suggestion = "a semantic token for this surface"
			}
			out = append(out, Finding{
				File: path, Line: line, Prop: prop, Raw: raw, Suggestion: suggestion,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Line < out[j].Line })
	return out
}

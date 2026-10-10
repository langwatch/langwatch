package llmsim

import (
	"fmt"
	"math"
	mrand "math/rand/v2"
	"slices"
	"strings"
	"time"
)

// maxSchemaDepth stops a recursive $ref from recursing forever.
const maxSchemaDepth = 8

// schemaGen draws a value that satisfies a JSON schema from the call's
// random source, so the same request always yields the same JSON.
type schemaGen struct {
	r     *mrand.Rand
	chain *markov
	root  map[string]any
}

func (g *schemaGen) value(s map[string]any, depth int) any {
	if ref, ok := s["$ref"].(string); ok {
		if target := g.resolve(ref); target != nil && depth < maxSchemaDepth {
			return g.value(target, depth+1)
		}
		return nil
	}
	if c, ok := s["const"]; ok {
		return c
	}
	if enum, ok := s["enum"].([]any); ok && len(enum) > 0 {
		return enum[g.r.IntN(len(enum))]
	}
	if next := g.composed(s); next != nil {
		return g.value(next, depth+1)
	}
	return g.typed(s, depth)
}

// composed is the schema an anyOf or oneOf draws, or allOf merges; nil when
// s composes nothing.
func (g *schemaGen) composed(s map[string]any) map[string]any {
	for _, key := range []string{"anyOf", "oneOf"} {
		if alts := nonNull(schemas(s[key])); len(alts) > 0 {
			return alts[g.r.IntN(len(alts))]
		}
	}
	if all := schemas(s["allOf"]); len(all) > 0 {
		return mergeAll(s, all)
	}
	return nil
}

// typed draws a value for a schema by its type; a string when it has none.
func (g *schemaGen) typed(s map[string]any, depth int) any {
	switch schemaType(s) {
	case "object":
		return g.object(s, depth)
	case "array":
		return g.array(s, depth)
	case "integer":
		lo, hi := bounds(s, 0, 100)
		span := int64(math.Floor(hi)-math.Ceil(lo)) + 1
		if span < 1 {
			return int64(math.Ceil(lo))
		}
		return int64(math.Ceil(lo)) + g.r.Int64N(span)
	case "number":
		lo, hi := bounds(s, 0, 100)
		return math.Round((lo+g.r.Float64()*(hi-lo))*100) / 100
	case "boolean":
		return g.r.IntN(2) == 0
	case "null":
		return nil
	default:
		return g.str(s)
	}
}

// object always fills required keys and fills each optional key half the
// time, visiting keys in sorted order so the draw sequence is stable.
func (g *schemaGen) object(s map[string]any, depth int) map[string]any {
	out := map[string]any{}
	props, _ := s["properties"].(map[string]any)
	required := map[string]bool{}
	for _, k := range asSlice(s["required"]) {
		if name, ok := k.(string); ok {
			required[name] = true
		}
	}
	keys := make([]string, 0, len(props))
	for k := range props {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		if !required[k] && (depth >= maxSchemaDepth || g.r.IntN(2) == 0) {
			continue
		}
		sub, _ := props[k].(map[string]any)
		out[k] = g.value(sub, depth+1)
	}
	return out
}

func (g *schemaGen) array(s map[string]any, depth int) []any {
	lo, hi := intField(s, "minItems", 0), intField(s, "maxItems", -1)
	if hi < 0 {
		hi = lo + 3
	}
	if depth >= maxSchemaDepth {
		hi = lo
	}
	n := lo
	if hi > lo {
		n += g.r.IntN(hi - lo + 1)
	}
	prefix := schemas(s["prefixItems"])
	items, _ := s["items"].(map[string]any)
	out := make([]any, 0, n)
	for i := range n {
		item := items
		if i < len(prefix) {
			item = prefix[i]
		}
		out = append(out, g.value(item, depth+1))
	}
	return out
}

func (g *schemaGen) str(s map[string]any) string {
	switch s["format"] {
	case "date-time":
		return g.when().Format(time.RFC3339)
	case "date":
		return g.when().Format(time.DateOnly)
	case "email":
		return g.word() + "@example.com"
	case "uri", "url":
		return "https://example.com/" + g.word()
	case "uuid":
		b := make([]byte, 16)
		for i := range b {
			b[i] = byte(g.r.UintN(256))
		}
		b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
		return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
	}
	lo, hi := intField(s, "minLength", 0), intField(s, "maxLength", -1)
	out := g.chain.phrase(g.r, 2+g.r.IntN(6))
	for len(out) < lo {
		out += " " + g.chain.phrase(g.r, 4)
	}
	if hi >= 0 && len(out) > hi {
		out = strings.TrimRight(out[:hi], " ")
		for len(out) < lo {
			out += "x"
		}
	}
	return out
}

func (g *schemaGen) word() string {
	return strings.ToLower(strings.Fields(g.chain.phrase(g.r, 1))[0])
}

// when is a seeded instant in 2026, so dates look real and stay stable.
func (g *schemaGen) when() time.Time {
	return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(g.r.Int64N(365*24*3600)) * time.Second)
}

// resolve follows a local JSON pointer ("#/$defs/X", "#/definitions/X", "#").
func (g *schemaGen) resolve(ref string) map[string]any {
	if !strings.HasPrefix(ref, "#") {
		return nil
	}
	var node any = g.root
	for part := range strings.SplitSeq(strings.TrimPrefix(ref, "#"), "/") {
		if part == "" {
			continue
		}
		m, ok := node.(map[string]any)
		if !ok {
			return nil
		}
		node = m[strings.NewReplacer("~1", "/", "~0", "~").Replace(part)]
	}
	out, _ := node.(map[string]any)
	return out
}

// schemaType is the declared type, the first non-null of a type list, or the
// type the keywords imply.
func schemaType(s map[string]any) string {
	switch t := s["type"].(type) {
	case string:
		return t
	case []any:
		for _, v := range t {
			if name, ok := v.(string); ok && name != "null" {
				return name
			}
		}
		return "null"
	}
	switch {
	case s["properties"] != nil:
		return "object"
	case s["items"] != nil || s["prefixItems"] != nil:
		return "array"
	}
	return "string"
}

// bounds reads minimum/maximum (and the numeric exclusive forms) with
// defaults, keeping lo <= hi.
func bounds(s map[string]any, lo, hi float64) (float64, float64) {
	minSet, maxSet := false, false
	if v, ok := s["minimum"].(float64); ok {
		lo, minSet = v, true
	}
	if v, ok := s["exclusiveMinimum"].(float64); ok {
		lo, minSet = v+1, true
	}
	if v, ok := s["maximum"].(float64); ok {
		hi, maxSet = v, true
	}
	if v, ok := s["exclusiveMaximum"].(float64); ok {
		hi, maxSet = v-1, true
	}
	switch {
	case minSet && !maxSet:
		hi = lo + 100
	case maxSet && !minSet && hi < lo:
		lo = hi - 100
	}
	if hi < lo {
		hi = lo
	}
	return lo, hi
}

func intField(s map[string]any, key string, fallback int) int {
	if v, ok := s[key].(float64); ok {
		return int(v)
	}
	return fallback
}

func asSlice(v any) []any {
	out, _ := v.([]any)
	return out
}

func schemas(v any) []map[string]any {
	var out []map[string]any
	for _, item := range asSlice(v) {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func nonNull(alts []map[string]any) []map[string]any {
	var out []map[string]any
	for _, a := range alts {
		if a["type"] != "null" {
			out = append(out, a)
		}
	}
	if len(out) == 0 {
		return alts
	}
	return out
}

// mergeAll folds allOf branches into one schema: properties and required
// lists union, and any other keyword takes the last branch's value.
func mergeAll(base map[string]any, all []map[string]any) map[string]any {
	out := map[string]any{}
	props := map[string]any{}
	var required []any
	for _, s := range append([]map[string]any{base}, all...) {
		required = mergeInto(mergeTarget{out: out, props: props}, s, required)
	}
	if len(props) > 0 {
		out["properties"], out["type"] = props, "object"
	}
	if len(required) > 0 {
		out["required"] = required
	}
	return out
}

// mergeTarget is the schema mergeAll builds and the properties it unions.
type mergeTarget struct {
	out, props map[string]any
}

// mergeInto folds one allOf branch into target, returning the required list
// with the branch's own appended.
func mergeInto(target mergeTarget, s map[string]any, required []any) []any {
	for k, v := range s {
		switch k {
		case "allOf":
		case "properties":
			m, _ := v.(map[string]any)
			for name, p := range m {
				target.props[name] = p
			}
		case "required":
			required = append(required, asSlice(v)...)
		default:
			target.out[k] = v
		}
	}
	return required
}

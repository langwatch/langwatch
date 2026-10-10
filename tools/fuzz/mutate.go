package fuzz

import (
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// Mutation is one family of malformed input. SchemaInvalid marks a body the
// request schema forbids, so a 2xx is the "accepting forbidden input" oracle.
// Foreign swaps ids to another tenant's, for the cross-tenant oracle.
type Mutation struct {
	Name          string
	SchemaInvalid bool
	Foreign       bool
	InvalidID     bool
}

// Mutations are the families every write operation is fuzzed with; the read
// operations use only the id and auth families. Order is fixed for
// determinism.
var Mutations = []Mutation{
	{Name: "valid"},
	{Name: "missing-required", SchemaInvalid: true},
	{Name: "wrong-type", SchemaInvalid: true},
	{Name: "boundary-number"},
	{Name: "huge-string"},
	{Name: "empty-string"},
	{Name: "unicode-string"},
	{Name: "extra-keys"},
	{Name: "invalid-id", InvalidID: true},
	{Name: "foreign-id", Foreign: true},
}

// hugeStringLength is fixed so a huge-string mutation reproduces exactly.
const hugeStringLength = 20000

// MutateBody applies a body mutation to a synthesized valid body, returning a
// new body; the input is not changed. Selection is by first sorted key, so the
// result is deterministic with no randomness.
func MutateBody(schema map[string]any, valid any, mutation Mutation) any {
	body, ok := cloneMap(valid)
	if !ok {
		return valid
	}
	switch mutation.Name {
	case "missing-required":
		if names := diffkit.RequiredNames(schema); len(names) > 0 {
			delete(body, names[0])
		}
	case "boundary-number":
		if name := firstProp(schema, diffkit.KindNumber); name != "" {
			body[name] = 1e308
		}
	case "extra-keys":
		body["__fuzz_extra"] = "unexpected"
	default:
		if value, ok := stringPropMutations[mutation.Name]; ok {
			setFirstStringProp(body, schema, value)
		}
	}
	return body
}

func cloneMap(value any) (map[string]any, bool) {
	source, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	clone := make(map[string]any, len(source)+1)
	for key, item := range source {
		clone[key] = item
	}
	return clone, true
}

func firstStringProp(schema map[string]any) string { return firstProp(schema, diffkit.KindString) }

// firstProp is the first property (sorted) whose kind matches, so mutations are
// deterministic.
func firstProp(schema map[string]any, kind string) string {
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		return ""
	}
	names := make([]string, 0, len(properties))
	for name := range properties {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if property, ok := properties[name].(map[string]any); ok && diffkit.SchemaKind(property) == kind {
			return name
		}
	}
	return ""
}

// stringPropMutations are the mutations that replace the first string
// property's value, each building its value fresh.
var stringPropMutations = map[string]func() any{
	"wrong-type":     func() any { return map[string]any{"fuzz": "type-confused"} },
	"huge-string":    func() any { return strings.Repeat("A", hugeStringLength) },
	"empty-string":   func() any { return "" },
	"unicode-string": func() any { return "😀\u0000�‮中文" },
}

// setFirstStringProp sets the schema's first string property to value(),
// when it has one.
func setFirstStringProp(body map[string]any, schema map[string]any, value func() any) {
	if name := firstStringProp(schema); name != "" {
		body[name] = value()
	}
}

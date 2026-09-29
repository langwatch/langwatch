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
		for _, name := range diffkit.RequiredNames(schema) {
			delete(body, name)
			return body
		}
	case "wrong-type":
		if name := firstStringProp(schema); name != "" {
			body[name] = map[string]any{"fuzz": "type-confused"}
		}
	case "boundary-number":
		if name := firstProp(schema, diffkit.KindNumber); name != "" {
			body[name] = 1e308
		}
	case "huge-string":
		if name := firstStringProp(schema); name != "" {
			body[name] = strings.Repeat("A", hugeStringLength)
		}
	case "empty-string":
		if name := firstStringProp(schema); name != "" {
			body[name] = ""
		}
	case "unicode-string":
		if name := firstStringProp(schema); name != "" {
			body[name] = "😀\u0000�‮中文"
		}
	case "extra-keys":
		body["__fuzz_extra"] = "unexpected"
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

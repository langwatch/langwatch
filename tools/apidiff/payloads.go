package apidiff

import (
	"fmt"
	"strings"
)

// Fixed values for synthesized payloads: deterministic across runs so a diff
// never comes from the generator itself.
const (
	synthString   = "apidiff"
	synthDateTime = "2026-01-01T00:00:00Z"
	synthDate     = "2026-01-01"
	synthUUID     = "00000000-0000-4000-8000-000000000000"
	synthEmail    = "apidiff@example.com"
	synthURI      = "https://example.com/apidiff"
	synthDepthCap = 4
)

// SynthesizePayload generates a valid payload from a resolved JSON schema.
// Spec examples and defaults win; otherwise generation is type-driven:
// enums take their first value, objects carry required fields only, strings
// are format-aware, numbers are 1, booleans true, arrays one element. Past
// the depth cap the cheapest value of the declared kind is emitted.
func SynthesizePayload(schema map[string]any, depth int) any {
	if schema == nil {
		return map[string]any{}
	}
	if example, ok := schemaExample(schema); ok {
		return example
	}
	if value, ok := synthesizeCombinators(schema, depth); ok {
		return value
	}

	kind := schemaKind(schema)
	if depth > synthDepthCap {
		return cheapestValue(kind)
	}
	switch kind {
	case KindObject:
		return synthesizeObject(schema, depth)
	case KindArray:
		if items, ok := schema["items"].(map[string]any); ok {
			return []any{SynthesizePayload(items, depth+1)}
		}
		return []any{}
	case KindString:
		return synthesizeString(schema)
	case KindNumber:
		return float64(1)
	case KindBoolean:
		return true
	default:
		return nil
	}
}

// schemaExample picks a declared value: example, then the first entry of
// examples, then default, then the first enum value.
func schemaExample(schema map[string]any) (any, bool) {
	if example, ok := schema["example"]; ok {
		return example, true
	}
	if examples, ok := schema["examples"].([]any); ok && len(examples) > 0 {
		return examples[0], true
	}
	if fallback, ok := schema["default"]; ok {
		return fallback, true
	}
	if enum, ok := schema["enum"].([]any); ok && len(enum) > 0 {
		return enum[0], true
	}
	return nil, false
}

// synthesizeCombinators takes the first anyOf/oneOf branch, or merges every
// allOf branch; probing needs one valid value, not coverage of all branches.
func synthesizeCombinators(schema map[string]any, depth int) (any, bool) {
	if value, ok := synthesizeFirstBranch(schema, depth); ok {
		return value, true
	}
	return synthesizeAllOf(schema, depth)
}

// synthesizeFirstBranch takes the first branch of anyOf or oneOf.
func synthesizeFirstBranch(schema map[string]any, depth int) (any, bool) {
	for _, keyword := range []string{"anyOf", "oneOf"} {
		branches, ok := schema[keyword].([]any)
		if !ok || len(branches) == 0 {
			continue
		}
		if branch, ok := branches[0].(map[string]any); ok {
			return SynthesizePayload(branch, depth), true
		}
	}
	return nil, false
}

// synthesizeAllOf merges the synthesized objects of every allOf branch.
func synthesizeAllOf(schema map[string]any, depth int) (any, bool) {
	allOf, ok := schema["allOf"].([]any)
	if !ok {
		return nil, false
	}
	merged := map[string]any{}
	for _, entry := range allOf {
		branch, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		if value, ok := SynthesizePayload(branch, depth).(map[string]any); ok {
			for key, field := range value {
				merged[key] = field
			}
		}
	}
	return merged, true
}

// synthesizeObject emits required fields only. With no required list at all
// it emits every property, or the payload would be an empty object
// indistinguishable from the validation probe.
func synthesizeObject(schema map[string]any, depth int) any {
	required := requiredSet(schema)
	properties, _ := schema["properties"].(map[string]any)
	result := map[string]any{}
	for _, name := range sortedKeys(properties) {
		if len(required) > 0 && !required[name] {
			continue
		}
		if property, ok := properties[name].(map[string]any); ok {
			result[name] = SynthesizePayload(property, depth+1)
		}
	}
	return result
}

// requiredSet reads a schema's required list into a set.
func requiredSet(schema map[string]any) map[string]bool {
	required := map[string]bool{}
	list, ok := schema["required"].([]any)
	if !ok {
		return required
	}
	for _, name := range list {
		if name, ok := name.(string); ok {
			required[name] = true
		}
	}
	return required
}

// synthesizeString is format-aware so validators see plausible values.
func synthesizeString(schema map[string]any) any {
	switch format, _ := schema["format"].(string); format {
	case "date-time":
		return synthDateTime
	case "date":
		return synthDate
	case "uuid":
		return synthUUID
	case "email":
		return synthEmail
	case "uri", "url":
		return synthURI
	default:
		return synthString
	}
}

// schemaKind resolves the effective JSON kind of a schema, defaulting to
// object when properties are declared without an explicit type.
func schemaKind(schema map[string]any) string {
	if kind, ok := schema["type"].(string); ok {
		switch kind {
		case "object":
			return KindObject
		case "array":
			return KindArray
		case "string":
			return KindString
		case "number", "integer":
			return KindNumber
		case "boolean":
			return KindBoolean
		case "null":
			return KindNull
		}
		return kind
	}
	if _, ok := schema["properties"]; ok {
		return KindObject
	}
	if _, ok := schema["items"]; ok {
		return KindArray
	}
	return KindObject
}

func cheapestValue(kind string) any {
	switch kind {
	case KindObject:
		return map[string]any{}
	case KindArray:
		return []any{}
	case KindString:
		return synthString
	case KindNumber:
		return float64(1)
	case KindBoolean:
		return true
	default:
		return nil
	}
}

// ValidationBody builds the invalid probe body for a write operation: an
// empty object when the schema declares required fields, otherwise a
// type-confused body (object where a string is expected) on the first string
// property.
func ValidationBody(schema map[string]any) any {
	if schema == nil {
		return map[string]any{}
	}
	if required, ok := schema["required"].([]any); ok && len(required) > 0 {
		return map[string]any{}
	}
	properties, _ := schema["properties"].(map[string]any)
	for _, name := range sortedKeys(properties) {
		property, ok := properties[name].(map[string]any)
		if !ok {
			continue
		}
		if schemaKind(property) == KindString {
			return map[string]any{name: map[string]any{}}
		}
	}
	return map[string]any{}
}

// SymbolTable holds IDs captured from earlier responses this run, keyed by
// the operation that produced them. Resolution falls back to any captured
// value, most recent first.
type SymbolTable struct {
	byOperation map[string][]string
	all         []string
}

// NewSymbolTable returns an empty table.
func NewSymbolTable() *SymbolTable {
	return &SymbolTable{byOperation: map[string][]string{}}
}

// Capture walks a decoded response body in sorted-key order (deterministic:
// capture order feeds fallback resolution) and records string values under
// id-like keys, tagged with the producing operation. Returns the captured IDs.
func (table *SymbolTable) Capture(operationID string, body any) []string {
	captured := make([]string, 0)
	table.captureValue(operationID, body, &captured)
	return captured
}

func (table *SymbolTable) captureValue(operationID string, value any, captured *[]string) {
	switch typed := value.(type) {
	case map[string]any:
		table.captureObject(operationID, typed, captured)
	case []any:
		for _, element := range typed {
			table.captureValue(operationID, element, captured)
		}
	}
}

func (table *SymbolTable) captureObject(operationID string, object map[string]any, captured *[]string) {
	for _, key := range sortedKeys(object) {
		child := object[key]
		if text, ok := child.(string); ok && isIDKey(key) && text != "" {
			table.byOperation[operationID] = append(table.byOperation[operationID], text)
			table.all = append(table.all, text)
			*captured = append(*captured, text)
		}
		table.captureValue(operationID, child, captured)
	}
}

// Lookup returns a captured ID for the operation, or any captured ID when
// the operation has none of its own.
func (table *SymbolTable) Lookup(operationID string) (string, bool) {
	if values := table.byOperation[operationID]; len(values) > 0 {
		return values[len(values)-1], true
	}
	if len(table.all) > 0 {
		return table.all[len(table.all)-1], true
	}
	return "", false
}

// isIDKey matches the identifier subset of the volatile key patterns.
func isIDKey(key string) bool {
	return key == "id" || strings.HasSuffix(key, "_id") || strings.HasSuffix(key, "Id")
}

// SeededConstants maps normalized parameter names to the fixed identities
// the deterministic seed creates (packages/prisma-client/prisma/seed.ts).
var SeededConstants = map[string]string{
	"projectid":      "local-dev-project",
	"project":        "local-dev-project",
	"organizationid": "local-dev-organization",
	"organisationid": "local-dev-organization",
	"orgid":          "local-dev-organization",
	"organization":   "local-dev-organization",
	"teamid":         "local-dev-team",
	"team":           "local-dev-team",
}

// ResolveParam picks a value for a path or required query parameter: spec
// examples/defaults first, then seeded constants matched by name, then the
// symbol table.
func ResolveParam(param Param, symbols *SymbolTable, operationID string) (string, bool) {
	if param.HasValue {
		return fmt.Sprint(param.Example), true
	}
	if value, ok := SeededConstants[normalizeParamName(param.Name)]; ok {
		return value, true
	}
	return symbols.Lookup(operationID)
}

func normalizeParamName(name string) string {
	name = strings.ToLower(name)
	return strings.ReplaceAll(strings.ReplaceAll(name, "-", ""), "_", "")
}

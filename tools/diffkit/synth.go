package diffkit

import "sort"

// Copied from tools/apidiff/payloads.go so the fuzzer synthesizes valid bodies
// the same way; switch apidiff onto diffkit later.

// JSON kinds a schema resolves to.
const (
	KindObject  = "object"
	KindArray   = "array"
	KindString  = "string"
	KindNumber  = "number"
	KindBoolean = "boolean"
	KindNull    = "null"
)

// Fixed values for synthesized payloads: deterministic across runs so a finding
// never comes from the generator itself.
const (
	synthString   = "fuzzer"
	synthDateTime = "2026-01-01T00:00:00Z"
	synthDate     = "2026-01-01"
	synthUUID     = "00000000-0000-4000-8000-000000000000"
	synthEmail    = "fuzzer@example.com"
	synthURI      = "https://example.com/fuzzer"
	synthDepthCap = 4
)

// SynthesizePayload generates a valid payload from a resolved JSON schema.
// Examples and defaults win; otherwise generation is type-driven: enums take
// their first value, objects carry required fields only, strings are
// format-aware, numbers 1, booleans true, arrays one element.
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

func synthesizeCombinators(schema map[string]any, depth int) (any, bool) {
	if value, ok := synthesizeFirstBranch(schema, depth); ok {
		return value, true
	}
	return synthesizeAllOf(schema, depth)
}

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

// RequiredNames returns a schema's declared required property names.
func RequiredNames(schema map[string]any) []string {
	names := make([]string, 0)
	for name := range requiredSet(schema) {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// SchemaKind exposes a schema's resolved JSON kind for the mutators.
func SchemaKind(schema map[string]any) string { return schemaKind(schema) }

package llmsim

import (
	"encoding/json"
	"regexp"
	"strings"
)

// A json_object request carries no schema, so the shape comes from the prompt:
// a JSON schema block it embeds, else the **bold** field names its numbered
// instructions list.
var (
	embeddedSchemaMarker = "JSON schema:"
	boldFieldLine        = regexp.MustCompile(`(?m)^[ \t]*(?:\d+\.[ \t]*)?\*\*([A-Za-z_][A-Za-z0-9_]*)\*\*[^\n]*`)
	listHint             = regexp.MustCompile(`\b\d+\s*-\s*\d+\s+\w+|\blist\b`)
)

// promptObjectSchema is the object schema a json_object request's prompt
// describes; nil when it describes none, which keeps the {"answer": ...} reply.
func promptObjectSchema(turns []turn) map[string]any {
	var prompt strings.Builder
	for _, t := range turns {
		if t.role == "system" || t.role == "user" {
			prompt.WriteString(t.text)
			prompt.WriteString("\n")
		}
	}
	text := prompt.String()
	if schema := embeddedObjectSchema(text); schema != nil {
		return schema
	}
	return boldFieldsSchema(text)
}

func embeddedObjectSchema(text string) map[string]any {
	i := strings.Index(text, embeddedSchemaMarker)
	if i < 0 {
		return nil
	}
	var schema map[string]any
	dec := json.NewDecoder(strings.NewReader(strings.TrimSpace(text[i+len(embeddedSchemaMarker):])))
	if dec.Decode(&schema) != nil || schemaType(schema) != "object" {
		return nil
	}
	return schema
}

func boldFieldsSchema(text string) map[string]any {
	props := map[string]any{}
	required := []any{}
	for _, m := range boldFieldLine.FindAllStringSubmatch(text, -1) {
		name := m[1]
		if _, seen := props[name]; seen {
			continue
		}
		props[name] = map[string]any{"type": "string"}
		if listHint.MatchString(strings.ToLower(m[0])) {
			props[name] = map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "minItems": float64(3)}
		}
		required = append(required, name)
	}
	if len(props) == 0 {
		return nil
	}
	return map[string]any{"type": "object", "properties": props, "required": required}
}

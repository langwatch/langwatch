package readmegen

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
)

// maxPrintedLines is the longest declaration printed inline; a longer one links to its source.
const maxPrintedLines = 12

// Schemas is every JSON Schema the extractor converted from zod, as apidiff converts them.
type Schemas struct {
	Rest   []RestSchemas `json:"rest"`
	Trpc   []TrpcSchemas `json:"trpc"`
	Errors []string      `json:"errors"`
}

// RestSchemas is one installed REST route's schemas by role (params, query, body, response).
type RestSchemas struct {
	Namespace string                     `json:"namespace"`
	Operation string                     `json:"operation"`
	Schemas   map[string]json.RawMessage `json:"schemas"`
}

// TrpcSchemas is one contract procedure's input and output.
type TrpcSchemas struct {
	Path   string          `json:"path"`
	Input  json.RawMessage `json:"input"`
	Output json.RawMessage `json:"output"`
}

// schemaIndex finds a converted schema by REST operation or tRPC path; printed
// holds the named schemas a page has already printed, so each prints once.
type schemaIndex struct {
	rest    map[string]map[string]json.RawMessage
	trpc    map[string]TrpcSchemas
	printed map[Location]bool
}

// forPage is the index with nothing printed yet.
func (index schemaIndex) forPage() schemaIndex {
	index.printed = map[Location]bool{}
	return index
}

// line prints a schema once per page; a named schema met again links to its source.
func (index schemaIndex) line(dir string, ref SchemaRef, raw json.RawMessage) string {
	if !ref.Inline && index.printed[ref.At] {
		raw = nil
	}
	out := schemaLine(dir, ref, raw)
	if !ref.Inline && index.printed != nil && strings.Count(out, "\n") > 1 {
		index.printed[ref.At] = true
	}
	return out
}

func newSchemaIndex(schemas Schemas) schemaIndex {
	index := schemaIndex{rest: map[string]map[string]json.RawMessage{}, trpc: map[string]TrpcSchemas{}}
	for _, route := range schemas.Rest {
		index.rest[route.Namespace+" "+route.Operation] = route.Schemas
	}
	for _, procedure := range schemas.Trpc {
		index.trpc[procedure.Path] = procedure
	}
	return index
}

// restSchema is the converted schema of one role of a route, or nil.
func (index schemaIndex) restSchema(family *RestFamily, route *RestRoute, role string) json.RawMessage {
	if !family.Namespace.Resolved || !route.Operation.Resolved {
		return nil
	}
	return index.rest[family.Namespace.Value+" "+route.Operation.Value][role]
}

// trpcSchema is the converted input or output of one procedure, or nil.
func (index schemaIndex) trpcSchema(router *TrpcRouter, procedure *TrpcProcedure, role string) json.RawMessage {
	found := index.trpc[router.Namespace.Value+"."+procedure.Name]
	if role == "input" {
		return found.Input
	}
	return found.Output
}

// unconvertedSchemas counts declared schemas with no converted JSON Schema.
func unconvertedSchemas(manifest Manifest) int {
	index := newSchemaIndex(manifest.Schemas)
	count := 0
	for module := range manifest.Modules {
		process := &manifest.Modules[module].Process
		for family := range process.Rest {
			count += index.restUnconverted(&process.Rest[family])
		}
		for router := range process.Trpc {
			count += index.trpcUnconverted(&process.Trpc[router])
		}
	}
	return count
}

func (index schemaIndex) restUnconverted(family *RestFamily) int {
	count := 0
	for route := range family.Routes {
		for _, ref := range family.Routes[route].Schemas {
			if _, runtime := runtimeRoles[ref.Role]; runtime {
				count += unresolved(converted(index.restSchema(family, &family.Routes[route], ref.Role)))
			}
		}
	}
	return count
}

func (index schemaIndex) trpcUnconverted(router *TrpcRouter) int {
	count := 0
	for inner := range router.Procedures {
		procedure := &router.Procedures[inner]
		for _, ref := range []*SchemaRef{procedure.Input, procedure.Output} {
			if ref != nil {
				count += unresolved(converted(index.trpcSchema(router, procedure, ref.Role)))
			}
		}
	}
	return count
}

// runtimeRoles are the REST roles the extractor converts.
var runtimeRoles = map[string]struct{}{"params": {}, "query": {}, "body": {}, "response": {}}

func converted(raw json.RawMessage) bool {
	node := decodeSchema(raw)
	object, isObject := node.(*jsonObject)
	return node != nil && (!isObject || !object.has("unconverted"))
}

// jsonObject is a decoded JSON object that keeps its keys in source order.
type jsonObject struct {
	keys   []string
	values map[string]any
}

func (o *jsonObject) get(key string) any {
	if o == nil {
		return nil
	}
	return o.values[key]
}

func (o *jsonObject) has(key string) bool {
	if o == nil {
		return false
	}
	_, ok := o.values[key]
	return ok
}

func decodeSchema(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	node, err := decodeOrdered(json.NewDecoder(bytes.NewReader(raw)))
	if err != nil {
		return nil
	}
	return node
}

func decodeOrdered(decoder *json.Decoder) (any, error) {
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	switch token {
	case json.Delim('{'):
		return decodeObject(decoder)
	case json.Delim('['):
		return decodeList(decoder)
	}
	return token, nil
}

func decodeObject(decoder *json.Decoder) (any, error) {
	object := &jsonObject{values: map[string]any{}}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		value, err := decodeOrdered(decoder)
		if err != nil {
			return nil, err
		}
		name, _ := key.(string)
		object.keys = append(object.keys, name)
		object.values[name] = value
	}
	_, err := decoder.Token()
	return object, err
}

func decodeList(decoder *json.Decoder) (any, error) {
	list := []any{}
	for decoder.More() {
		value, err := decodeOrdered(decoder)
		if err != nil {
			return nil, err
		}
		list = append(list, value)
	}
	_, err := decoder.Token()
	return list, err
}

// declaration prints a schema as a TypeScript declaration named `name`, or
// "" when it was not converted or is too long to print.
func declaration(name string, raw json.RawMessage) string {
	if !converted(raw) {
		return ""
	}
	node := decodeSchema(raw)
	root, _ := node.(*jsonObject)
	p := &tsPrinter{root: name, defs: &jsonObject{values: map[string]any{}}}
	if defs, ok := root.get("$defs").(*jsonObject); ok {
		p.defs = defs
	}
	body := p.typeOf(node, "")
	out := "type " + name + " = " + body + ";\n"
	if strings.HasPrefix(body, "{") && root.get("type") == "object" {
		out = "interface " + name + " " + body + "\n"
	}
	for _, def := range p.defs.keys {
		out += "type " + p.defName(def) + " = " + p.typeOf(p.defs.get(def), "") + ";\n"
	}
	if strings.Count(out, "\n") > maxPrintedLines {
		return ""
	}
	return out
}

type tsPrinter struct {
	root string
	defs *jsonObject
}

// defName names a shared definition after the declaration it serves: `__schema0` of Input is InputSchema0.
func (p *tsPrinter) defName(def string) string {
	name := strings.Trim(def, "_")
	if name == "" {
		return p.root + "Definition"
	}
	return p.root + strings.ToUpper(name[:1]) + name[1:]
}

func (p *tsPrinter) typeOf(node any, indent string) string {
	schema, ok := node.(*jsonObject)
	if !ok {
		if node == false {
			return "never"
		}
		return "unknown"
	}
	if ref, ok := schema.get("$ref").(string); ok {
		if ref == "#" {
			return p.root
		}
		return p.defName(strings.TrimPrefix(ref, "#/$defs/"))
	}
	if schema.has("const") {
		return literal(schema.get("const"))
	}
	if values, ok := schema.get("enum").([]any); ok {
		return p.join(values, " | ", literal)
	}
	if composite, ok := p.composite(schema, indent); ok {
		return composite
	}
	return p.typed(schema, indent)
}

// composite is a union or intersection: anyOf, oneOf, allOf or a list of types.
func (p *tsPrinter) composite(schema *jsonObject, indent string) (string, bool) {
	each := func(option any) string { return p.typeOf(option, indent) }
	for _, key := range []string{"anyOf", "oneOf"} {
		if options, ok := schema.get(key).([]any); ok {
			return p.join(options, " | ", each), true
		}
	}
	if parts, ok := schema.get("allOf").([]any); ok {
		return p.join(parts, " & ", each), true
	}
	if kinds, ok := schema.get("type").([]any); ok {
		return p.join(kinds, " | ", func(kind any) string { return p.typeOf(withType(schema, kind), indent) }), true
	}
	return "", false
}

func (p *tsPrinter) typed(schema *jsonObject, indent string) string {
	switch schema.get("type") {
	case "string":
		return "string"
	case "number", "integer":
		return "number"
	case "boolean":
		return "boolean"
	case "null":
		return "null"
	case "array":
		return p.array(schema, indent)
	case "object":
		return p.object(schema, indent)
	}
	if schema.has("properties") {
		return p.object(schema, indent)
	}
	return "unknown"
}

func (p *tsPrinter) array(schema *jsonObject, indent string) string {
	if items, ok := schema.get("prefixItems").([]any); ok {
		return "[" + p.join(items, ", ", func(item any) string { return p.typeOf(item, indent) }) + "]"
	}
	item := p.typeOf(schema.get("items"), indent)
	if strings.ContainsAny(item, "|&") && !strings.HasPrefix(item, "{") {
		item = "(" + item + ")"
	}
	return item + "[]"
}

func (p *tsPrinter) object(schema *jsonObject, indent string) string {
	properties, _ := schema.get("properties").(*jsonObject)
	extra, open := schema.get("additionalProperties").(*jsonObject)
	if properties == nil || len(properties.keys) == 0 {
		return p.record(schema, indent)
	}
	required := requiredSet(schema)
	inner := indent + "  "
	out := "{\n"
	for _, name := range properties.keys {
		mark := "?"
		if required[name] {
			mark = ""
		}
		out += inner + propertyName(name) + mark + ": " + p.typeOf(properties.get(name), inner) + ";\n"
	}
	if open {
		out += inner + "[key: string]: " + p.typeOf(extra, inner) + ";\n"
	}
	return out + indent + "}"
}

// record is an object without properties: a map, a closed empty object or any object.
func (p *tsPrinter) record(schema *jsonObject, indent string) string {
	if extra, open := schema.get("additionalProperties").(*jsonObject); open {
		return "Record<string, " + p.typeOf(extra, indent) + ">"
	}
	if schema.get("additionalProperties") == false {
		return "{}"
	}
	return "Record<string, unknown>"
}

func requiredSet(schema *jsonObject) map[string]bool {
	required := map[string]bool{}
	list, _ := schema.get("required").([]any)
	for _, name := range list {
		if text, ok := name.(string); ok {
			required[text] = true
		}
	}
	return required
}

func (p *tsPrinter) join(items []any, separator string, each func(any) string) string {
	parts := make([]string, 0, len(items))
	for _, item := range items {
		text := each(item)
		if !contains(parts, text) {
			parts = append(parts, text)
		}
	}
	if len(parts) == 0 {
		return "never"
	}
	return strings.Join(parts, separator)
}

func withType(schema *jsonObject, kind any) *jsonObject {
	copied := &jsonObject{keys: schema.keys, values: make(map[string]any, len(schema.values))}
	for key, value := range schema.values {
		copied.values[key] = value
	}
	copied.values["type"] = kind
	return copied
}

func literal(value any) string {
	if value == nil {
		return "null"
	}
	text, err := json.Marshal(value)
	if err != nil {
		return "unknown"
	}
	return string(text)
}
func propertyName(name string) string {
	for index, r := range name {
		letter := r == '_' || r == '$' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
		if !letter && (index == 0 || r < '0' || r > '9') {
			return strconv.Quote(name)
		}
	}
	if name == "" {
		return `""`
	}
	return name
}

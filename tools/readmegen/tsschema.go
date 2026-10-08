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

// declaration prints a schema as a TypeScript declaration named `name`, laid
// out as oxfmt would, or "" when it was not converted or is too long to print.
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
	body := p.typeOf(node)
	var out strings.Builder
	if body.object && root.get("type") == "object" {
		out.WriteString(layout(concat{text("interface " + name + " "), body.doc}) + "\n")
	} else {
		out.WriteString(layout(concat{text("type " + name + " ="), body.annotated(), text(";")}) + "\n")
	}
	for _, def := range p.defs.keys {
		alias := concat{text("type " + p.defName(def) + " ="), p.typeOf(p.defs.get(def)).annotated(), text(";")}
		out.WriteString(layout(alias) + "\n")
	}
	if strings.Count(out.String(), "\n") > maxPrintedLines {
		return ""
	}
	return out.String()
}

type tsPrinter struct {
	root string
	defs *jsonObject
}

// tsType is one printed type; members is set for a union, which prints
// differently after a colon than inside type arguments.
type tsType struct {
	doc         doc
	members     []doc
	object      bool
	needsParens bool
	multiline   bool
}

func plain(body doc) tsType { return tsType{doc: body} }

// annotated is the type after `name:` or `=`: a space then the type, or a break and a leading bar.
func (t tsType) annotated() doc {
	if t.members == nil {
		return concat{text(" "), t.doc}
	}
	return &group{body: indent{concat{line{lineSpace}, ifBreak{broken: text("| "), flat: text("")}, joinDocs(t.members, concat{line{lineSpace}, text("| ")})}}}
}

// inline is the type inside type arguments or a tuple.
func (t tsType) inline() doc {
	if t.members == nil {
		return t.doc
	}
	return &group{body: concat{ifBreak{broken: text("| "), flat: text("")}, joinDocs(t.members, concat{line{lineSpace}, text("| ")})}}
}

// defName names a shared definition after the declaration it serves: `__schema0` of Input is InputSchema0.
func (p *tsPrinter) defName(def string) string {
	name := strings.Trim(def, "_")
	if name == "" {
		return p.root + "Definition"
	}
	return p.root + strings.ToUpper(name[:1]) + name[1:]
}

func (p *tsPrinter) typeOf(node any) tsType {
	schema, ok := node.(*jsonObject)
	if !ok {
		if node == false {
			return plain(text("never"))
		}
		return plain(text("unknown"))
	}
	if ref, ok := schema.get("$ref").(string); ok {
		if ref == "#" {
			return plain(text(p.root))
		}
		return plain(text(p.defName(strings.TrimPrefix(ref, "#/$defs/"))))
	}
	if schema.has("const") {
		return plain(text(literal(schema.get("const"))))
	}
	if values, ok := schema.get("enum").([]any); ok {
		return p.union(values, func(value any) tsType { return plain(text(literal(value))) })
	}
	if composite, ok := p.composite(schema); ok {
		return composite
	}
	return p.typed(schema)
}

// composite is a union or intersection: anyOf, oneOf, allOf or a list of types.
func (p *tsPrinter) composite(schema *jsonObject) (tsType, bool) {
	for _, key := range []string{"anyOf", "oneOf"} {
		if options, ok := schema.get(key).([]any); ok {
			return p.union(options, p.typeOf), true
		}
	}
	if parts, ok := schema.get("allOf").([]any); ok {
		return p.intersection(parts), true
	}
	if kinds, ok := schema.get("type").([]any); ok {
		return p.union(kinds, func(kind any) tsType { return p.typeOf(withType(schema, kind)) }), true
	}
	return tsType{}, false
}

func (p *tsPrinter) typed(schema *jsonObject) tsType {
	switch schema.get("type") {
	case "string":
		return plain(text("string"))
	case "number", "integer":
		return plain(text("number"))
	case "boolean":
		return plain(text("boolean"))
	case "null":
		return plain(text("null"))
	case "array":
		return p.array(schema)
	case "object":
		return p.object(schema)
	}
	if schema.has("properties") {
		return p.object(schema)
	}
	return plain(text("unknown"))
}

func (p *tsPrinter) array(schema *jsonObject) tsType {
	if items, ok := schema.get("prefixItems").([]any); ok {
		return plain(&group{body: concat{text("["), indent{concat{line{lineSoft}, p.list(items)}}, line{lineSoft}, text("]")}})
	}
	item := p.typeOf(schema.get("items"))
	if item.needsParens && item.multiline {
		return plain(concat{text("("), item.inline(), text(")[]")})
	}
	if item.needsParens {
		return plain(&group{body: concat{text("("), indent{concat{line{lineSoft}, item.inline()}}, line{lineSoft}, text(")[]")}})
	}
	return plain(concat{item.doc, text("[]")})
}

// list is comma separated members; the union members of each stay inline.
func (p *tsPrinter) list(items []any) doc {
	docs := make([]doc, 0, len(items))
	for _, item := range items {
		docs = append(docs, p.typeOf(item).inline())
	}
	return joinDocs(docs, concat{text(","), line{lineSpace}})
}

func (p *tsPrinter) object(schema *jsonObject) tsType {
	properties, _ := schema.get("properties").(*jsonObject)
	extra, open := schema.get("additionalProperties").(*jsonObject)
	if properties == nil || len(properties.keys) == 0 {
		return p.record(schema)
	}
	required := requiredSet(schema)
	members := []doc{}
	for _, name := range properties.keys {
		mark := "?"
		if required[name] {
			mark = ""
		}
		members = append(members, concat{text(propertyName(name) + mark + ":"), p.typeOf(properties.get(name)).annotated(), text(";")})
	}
	if open {
		members = append(members, concat{text("[key: string]:"), p.typeOf(extra).annotated(), text(";")})
	}
	body := concat{text("{"), indent{concat{line{lineHard}, joinDocs(members, line{lineHard})}}, line{lineHard}, text("}")}
	return tsType{doc: body, object: true}
}

// record is an object without properties: a map, a closed empty object or any object.
func (p *tsPrinter) record(schema *jsonObject) tsType {
	if extra, open := schema.get("additionalProperties").(*jsonObject); open {
		arguments := concat{text("string,"), line{lineSpace}, p.typeOf(extra).inline()}
		return plain(&group{body: concat{text("Record<"), indent{concat{line{lineSoft}, arguments}}, line{lineSoft}, text(">")}})
	}
	if schema.get("additionalProperties") == false {
		return tsType{doc: text("{}"), object: true}
	}
	return plain(text("Record<string, unknown>"))
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

// distinct drops options that print the same, keeping the first.
func (p *tsPrinter) distinct(items []any, each func(any) tsType) []tsType {
	seen := []string{}
	parts := make([]tsType, 0, len(items))
	for _, item := range items {
		part := each(item)
		key := render(part.inline(), 1<<30)
		if !contains(seen, key) {
			seen = append(seen, key)
			parts = append(parts, part)
		}
	}
	return parts
}

// union prints oxfmt's way: members aligned under the bar; one object beside null hugs the brace.
func (p *tsPrinter) union(items []any, each func(any) tsType) tsType {
	parts := p.distinct(items, each)
	if flat, nested := flatten(parts); nested {
		parts = p.distinct(flat, func(part any) tsType { return part.(tsType) })
	}
	switch len(parts) {
	case 0:
		return plain(text("never"))
	case 1:
		return parts[0]
	}
	members := make([]doc, 0, len(parts))
	for _, part := range parts {
		members = append(members, indent{part.inline()})
	}
	if hugsObject(parts) {
		docs := make([]doc, 0, len(parts))
		for _, part := range parts {
			docs = append(docs, part.inline())
		}
		return tsType{doc: joinDocs(docs, text(" | ")), needsParens: true, multiline: true}
	}
	return tsType{members: members, needsParens: true}
}

// flatten splices the members of a nested union in place, as TypeScript reads `A | (B | C)`.
func flatten(parts []tsType) ([]any, bool) {
	out := make([]any, 0, len(parts))
	nested := false
	for _, part := range parts {
		if part.members == nil {
			out = append(out, part)
			continue
		}
		nested = true
		for _, member := range part.members {
			out = append(out, plain(member.(indent).body))
		}
	}
	return out, nested
}

// hugsObject is one object beside only null, which oxfmt keeps on one line.
func hugsObject(parts []tsType) bool {
	objects, nulls := 0, 0
	for _, part := range parts {
		if part.object {
			objects++
		}
		if name, ok := part.doc.(text); ok && name == "null" {
			nulls++
		}
	}
	return objects == 1 && nulls == len(parts)-1
}

func (p *tsPrinter) intersection(items []any) tsType {
	parts := p.distinct(items, p.typeOf)
	switch len(parts) {
	case 0:
		return plain(text("never"))
	case 1:
		return parts[0]
	}
	docs := make([]doc, 0, len(parts))
	for _, part := range parts {
		docs = append(docs, part.inline())
	}
	for _, part := range parts {
		if part.object {
			return tsType{doc: joinDocs(docs, text(" & ")), needsParens: true, multiline: true}
		}
	}
	return tsType{doc: &group{body: joinDocs(docs, concat{text(" &"), line{lineSpace}})}, needsParens: true}
}

func joinDocs(items []doc, separator doc) doc {
	out := concat{}
	for index, item := range items {
		if index > 0 {
			out = append(out, separator)
		}
		out = append(out, item)
	}
	return out
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

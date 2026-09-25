package openapidiff

import (
	"fmt"
	"sort"
	"strings"
)

// Change classes: a breaking change can refuse or mislead an existing caller;
// an additive one widens what the candidate accepts or answers.
const (
	ClassBreaking = "breaking"
	ClassAdditive = "additive"
	// ClassUnknown is a change under a node the base left open ({}, a bare
	// object or an itemless array): the base never said what it accepted there.
	ClassUnknown = "unknown"
	// ClassNotCompared is a documented error status: parity is not required.
	ClassNotCompared = "not-compared"
)

// Direction says which side of the wire a schema describes. A request schema
// breaks when the candidate accepts less; a response schema breaks when the
// candidate answers less.
type Direction int

// The two directions a schema can describe.
const (
	Request Direction = iota
	Response
)

// SchemaField is one node of a flattened schema.
type SchemaField struct {
	Types    []string `json:"types,omitempty"`
	Required bool     `json:"required"`
	Nullable bool     `json:"nullable,omitempty"`
	// Open is a node that declares no shape of its own: no properties, no
	// items, no composition, as a converter emits for a recursive schema.
	Open bool `json:"open,omitempty"`
}

// FieldChange is one field-level difference between two schemas or two
// operations. Field is a dotted location ("query.limit", "body.items[].id").
type FieldChange struct {
	Kind   string `json:"kind"`
	Class  string `json:"class"`
	Field  string `json:"field"`
	Before any    `json:"before,omitempty"`
	After  any    `json:"after,omitempty"`
}

const maxSchemaDepth = 8

// FlattenSchema resolves local references against document and returns every
// property node keyed by its dotted path; "$" is the schema itself.
func FlattenSchema(document map[string]any, schema any) map[string]SchemaField {
	walker := schemaWalker{document: document, fields: map[string]SchemaField{}}
	walker.walk(schemaNode{path: "$", required: true, seen: map[string]bool{}}, schema)
	return walker.fields
}

type schemaWalker struct {
	document map[string]any
	fields   map[string]SchemaField
}

// schemaNode is where the walk stands: the dotted path, whether its parent
// requires it, how deep it is, and the references already followed.
type schemaNode struct {
	path     string
	required bool
	depth    int
	seen     map[string]bool
}

func (node schemaNode) child(path string, required bool) schemaNode {
	return schemaNode{path: path, required: required, depth: node.depth + 1, seen: node.seen}
}

func (walker schemaWalker) resolve(schema any, seen map[string]bool) (map[string]any, map[string]bool) {
	object, ok := schema.(map[string]any)
	for ok {
		reference, isRef := object["$ref"].(string)
		if !isRef || seen[reference] || !strings.HasPrefix(reference, "#/") {
			break
		}
		seen = withReference(seen, reference)
		value, found := pointerValue(walker.document, reference)
		if !found {
			return object, seen
		}
		object, ok = value.(map[string]any)
	}
	return object, seen
}

func withReference(seen map[string]bool, reference string) map[string]bool {
	next := map[string]bool{reference: true}
	for key := range seen {
		next[key] = true
	}
	return next
}

func (walker schemaWalker) walk(node schemaNode, schema any) {
	object, seen := walker.resolve(schema, node.seen)
	if object == nil || node.depth > maxSchemaDepth {
		return
	}
	node.seen = seen
	walker.record(node.path, object, node.required)
	walker.walkChildren(node, object)
}

// record folds one schema object's own types into the node at path.
func (walker schemaWalker) record(path string, object map[string]any, required bool) {
	field := walker.fields[path]
	field.Required = field.Required || required
	types, nullable := schemaTypes(object)
	field.Types = mergeTypes(field.Types, types)
	field.Nullable = field.Nullable || nullable
	field.Open = field.Open || declaresNoShape(object, types)
	walker.fields[path] = field
}

func (walker schemaWalker) walkChildren(node schemaNode, object map[string]any) {
	requiredNames := map[string]bool{}
	for _, name := range asList(object["required"]) {
		if text, ok := name.(string); ok {
			requiredNames[text] = true
		}
	}
	properties, _ := object["properties"].(map[string]any)
	for name, property := range properties {
		walker.walk(node.child(childPath(node.path, name), requiredNames[name]), property)
	}
	if items, ok := object["items"]; ok {
		walker.walk(node.child(node.path+"[]", true), items)
	}
	for _, key := range []string{"allOf", "anyOf", "oneOf"} {
		keepRequired := key == "allOf" || onlyNullAlternative(asList(object[key]))
		for _, branch := range asList(object[key]) {
			walker.walkBranch(node, branch, keepRequired)
		}
	}
}

// onlyNullAlternative is anyOf/oneOf of one schema and {type: null}, the way
// a generator writes a nullable object: that object keeps its required list.
func onlyNullAlternative(branches []any) bool {
	others := 0
	for _, branch := range branches {
		object, _ := branch.(map[string]any)
		if object["type"] != "null" {
			others++
		}
	}
	return others == 1 && len(branches) > 1
}

// walkBranch folds a composition branch into the node it composes: allOf
// contributes its required list, anyOf/oneOf contribute shape but never make a
// property required, unless the only alternative is null.
func (walker schemaWalker) walkBranch(node schemaNode, branch any, required bool) {
	object, seen := walker.resolve(branch, node.seen)
	if object == nil {
		return
	}
	node.seen = seen
	walker.record(node.path, object, false)
	if !required {
		object = withoutRequired(object)
	}
	walker.walkChildren(node, object)
}

func declaresNoShape(object map[string]any, types []string) bool {
	for _, key := range []string{"properties", "items", "allOf", "anyOf", "oneOf", "enum", "const"} {
		if _, ok := object[key]; ok {
			return false
		}
	}
	for _, name := range types {
		if name != "object" && name != "array" {
			return false
		}
	}
	return true
}

func withoutRequired(object map[string]any) map[string]any {
	copied := make(map[string]any, len(object))
	for key, value := range object {
		if key != "required" {
			copied[key] = value
		}
	}
	return copied
}

// pointerValue follows a local JSON pointer ("#/components/schemas/X",
// "#/$defs/X") through document.
func pointerValue(document map[string]any, reference string) (any, bool) {
	var current any = document
	for _, part := range strings.Split(strings.TrimPrefix(reference, "#/"), "/") {
		name, ok := decodePointer(part)
		if !ok {
			return nil, false
		}
		object, isObject := current.(map[string]any)
		if !isObject {
			return nil, false
		}
		if current, ok = object[name]; !ok {
			return nil, false
		}
	}
	return current, true
}

func fieldLocation(prefix, path string) string {
	rest := strings.TrimPrefix(strings.TrimPrefix(path, "$"), ".")
	switch {
	case prefix == "" && rest == "":
		return "$"
	case prefix == "":
		return rest
	case rest == "" || strings.HasPrefix(rest, "[]"):
		return prefix + rest
	default:
		return prefix + "." + rest
	}
}

func childPath(path, name string) string {
	if path == "$" {
		return name
	}
	return path + "." + name
}

func asList(value any) []any {
	list, _ := value.([]any)
	return list
}

// schemaTypes reads a node's own JSON types, treating "null" (and the 3.0
// nullable flag) as nullability rather than a type.
func schemaTypes(object map[string]any) ([]string, bool) {
	nullable, _ := object["nullable"].(bool)
	kept := []string{}
	for _, name := range typeNames(object) {
		if name == "null" {
			nullable = true
			continue
		}
		kept = append(kept, name)
	}
	return kept, nullable
}

func typeNames(object map[string]any) []string {
	switch typed := object["type"].(type) {
	case string:
		return []string{typed}
	case []any:
		names := []string{}
		for _, item := range typed {
			if text, ok := item.(string); ok {
				names = append(names, text)
			}
		}
		return names
	}
	if _, ok := object["properties"]; ok {
		return []string{"object"}
	}
	return nil
}

func mergeTypes(left, right []string) []string {
	set := map[string]bool{}
	for _, name := range append(append([]string{}, left...), right...) {
		set[name] = true
	}
	merged := make([]string, 0, len(set))
	for name := range set {
		merged = append(merged, name)
	}
	sort.Strings(merged)
	return merged
}

// Comparison is how two flattened schemas are read against each other: which
// side of the wire they describe, and the location prefix every field carries.
type Comparison struct {
	Direction Direction
	Prefix    string
}

// Compare reports the field-level differences between two flattened schemas.
// A node whose parent was added or removed is not reported again, and on a
// request a change below a node the base left open is unknown, never breaking.
func (comparison Comparison) Compare(base, candidate map[string]SchemaField) []FieldChange {
	changes := []FieldChange{}
	gone := map[string]bool{}
	open := openNodes(base)
	for _, path := range unionKeys(base, candidate) {
		if underGone(path, gone) {
			continue
		}
		if _, inBase := base[path]; !inBase {
			gone[path] = true
		} else if _, inCandidate := candidate[path]; !inCandidate {
			gone[path] = true
		}
		compared := comparison.comparePath(path, base, candidate)
		if comparison.Direction == Request && underOpen(path, open) {
			compared = reclassified(compared, ClassUnknown)
		}
		changes = append(changes, compared...)
	}
	return changes
}

// openNodes are the base's open nodes that have no children of their own.
func openNodes(fields map[string]SchemaField) map[string]bool {
	parents := map[string]bool{}
	for path := range fields {
		if parent, ok := parentPath(path); ok {
			parents[parent] = true
		}
	}
	open := map[string]bool{}
	for path, field := range fields {
		if field.Open && !parents[path] {
			open[path] = true
		}
	}
	return open
}

func parentPath(path string) (string, bool) {
	switch {
	case path == "$":
		return "", false
	case strings.HasSuffix(path, "[]"):
		return strings.TrimSuffix(path, "[]"), true
	case strings.Contains(path, "."):
		return path[:strings.LastIndex(path, ".")], true
	default:
		return "$", true
	}
}

func underOpen(path string, open map[string]bool) bool {
	for parent, ok := parentPath(path); ok; parent, ok = parentPath(parent) {
		if open[parent] {
			return true
		}
	}
	return false
}

func reclassified(changes []FieldChange, class string) []FieldChange {
	for index := range changes {
		changes[index].Class = class
	}
	return changes
}

func (comparison Comparison) comparePath(path string, base, candidate map[string]SchemaField) []FieldChange {
	before, inBase := base[path]
	after, inCandidate := candidate[path]
	location := fieldLocation(comparison.Prefix, path)
	switch {
	case inBase && !inCandidate:
		return []FieldChange{{Kind: "property_removed", Class: ClassBreaking, Field: location, Before: before}}
	case !inBase && inCandidate:
		return []FieldChange{{Kind: "property_added", Class: classIf(comparison.Direction == Request && after.Required), Field: location, After: after}}
	}
	changes := []FieldChange{}
	if change, ok := comparison.typeChange(location, before, after); ok {
		changes = append(changes, change)
	}
	if before.Required != after.Required {
		breaking := (comparison.Direction == Request && after.Required) || (comparison.Direction == Response && before.Required)
		changes = append(changes, FieldChange{Kind: "required_changed", Class: classIf(breaking), Field: location, Before: before.Required, After: after.Required})
	}
	return changes
}

func (comparison Comparison) typeChange(location string, before, after SchemaField) (FieldChange, bool) {
	if equalTypes(before.Types, after.Types) && before.Nullable == after.Nullable {
		return FieldChange{}, false
	}
	narrower, wider := after, before
	if comparison.Direction == Response {
		narrower, wider = before, after
	}
	return FieldChange{Kind: "type_changed", Class: classIf(!typesWithin(wider, narrower)), Field: location, Before: typeLabel(before), After: typeLabel(after)}, true
}

func classIf(breaking bool) string {
	if breaking {
		return ClassBreaking
	}
	return ClassAdditive
}

// typesWithin reports whether every value inner admits, outer admits too. An
// untyped node admits anything; integer sits inside number.
func typesWithin(inner, outer SchemaField) bool {
	if inner.Nullable && !outer.Nullable {
		return false
	}
	if len(outer.Types) == 0 {
		return true
	}
	if len(inner.Types) == 0 {
		return false
	}
	for _, name := range inner.Types {
		if !containsType(outer.Types, name) && (name != "integer" || !containsType(outer.Types, "number")) {
			return false
		}
	}
	return true
}

func containsType(types []string, want string) bool {
	for _, name := range types {
		if name == want {
			return true
		}
	}
	return false
}

func equalTypes(left, right []string) bool {
	return strings.Join(left, ",") == strings.Join(right, ",")
}

func typeLabel(field SchemaField) string {
	label := strings.Join(field.Types, "|")
	if label == "" {
		label = "any"
	}
	if field.Nullable {
		label += "|null"
	}
	return label
}

func underGone(path string, gone map[string]bool) bool {
	for parent := range gone {
		if strings.HasPrefix(path, parent+".") || strings.HasPrefix(path, parent+"[]") {
			return true
		}
	}
	return false
}

// documents is the pair an operation is compared across; each side's
// references resolve against its own document.
type documents struct {
	base      map[string]any
	candidate map[string]any
}

// ClassifyOperation turns one "changed" operation into field-level changes,
// resolving each side's references against its own document.
func ClassifyOperation(base, candidate map[string]any, change Change) []FieldChange {
	docs := documents{base: base, candidate: candidate}
	changes := []FieldChange{}
	for _, key := range sortedChangeFields(change.Fields) {
		changes = append(changes, docs.classifyField(key, change.Fields[key])...)
	}
	return changes
}

func (docs documents) classifyField(key string, pair [2]any) []FieldChange {
	switch key {
	case "parameters":
		return docs.compareParameters(pair[0], pair[1])
	case "requestBody":
		return docs.compareRequestBody(pair[0], pair[1])
	case "responses":
		return docs.compareResponses(pair[0], pair[1])
	case "security":
		return []FieldChange{{Kind: "security_changed", Class: ClassBreaking, Field: "security", Before: pair[0], After: pair[1]}}
	default:
		return []FieldChange{{Kind: "docs_changed", Class: ClassAdditive, Field: key}}
	}
}

func sortedChangeFields(fields map[string][2]any) []string {
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

type parameter struct {
	required bool
	schema   any
}

func parametersByIdentity(document map[string]any, value any) map[string]parameter {
	result := map[string]parameter{}
	walker := schemaWalker{document: document}
	for _, item := range asList(value) {
		object, _ := walker.resolve(item, map[string]bool{})
		if object == nil {
			continue
		}
		name, _ := object["name"].(string)
		location, _ := object["in"].(string)
		required, _ := object["required"].(bool)
		result[location+"."+name] = parameter{required: required || location == "path", schema: object["schema"]}
	}
	return result
}

func (docs documents) compareParameters(before, after any) []FieldChange {
	baseParams := parametersByIdentity(docs.base, before)
	candidateParams := parametersByIdentity(docs.candidate, after)
	changes := []FieldChange{}
	for _, key := range unionKeys(baseParams, candidateParams) {
		was, inBase := baseParams[key]
		now, inCandidate := candidateParams[key]
		switch {
		case inBase && !inCandidate:
			changes = append(changes, FieldChange{Kind: "param_removed", Class: ClassBreaking, Field: key})
		case !inBase && inCandidate:
			changes = append(changes, FieldChange{Kind: "param_added", Class: classIf(now.required), Field: key, After: map[string]any{"required": now.required}})
		default:
			changes = append(changes, docs.compareParameter(key, was, now)...)
		}
	}
	return changes
}

func (docs documents) compareParameter(key string, was, now parameter) []FieldChange {
	changes := []FieldChange{}
	if was.required != now.required {
		changes = append(changes, FieldChange{Kind: "param_required_changed", Class: classIf(now.required), Field: key, Before: was.required, After: now.required})
	}
	compared := Comparison{Direction: Request, Prefix: key}.Compare(FlattenSchema(docs.base, was.schema), FlattenSchema(docs.candidate, now.schema))
	return append(changes, renamed(compared, "param_")...)
}

func unionKeys[V any](left, right map[string]V) []string {
	set := map[string]bool{}
	for key := range left {
		set[key] = true
	}
	for key := range right {
		set[key] = true
	}
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func renamed(changes []FieldChange, prefix string) []FieldChange {
	for index := range changes {
		changes[index].Kind = prefix + changes[index].Kind
	}
	return changes
}

// media is a request body's or response's chosen body schema.
type media struct {
	schema   any
	required bool
	present  bool
}

// mediaSchema picks the JSON body schema of a request body or response,
// falling back to the first media type declared.
func mediaSchema(document map[string]any, value any) media {
	object, _ := schemaWalker{document: document}.resolve(value, map[string]bool{})
	if object == nil {
		return media{}
	}
	required, _ := object["required"].(bool)
	content, _ := object["content"].(map[string]any)
	if schema, ok := content["application/json"].(map[string]any); ok {
		return media{schema: schema["schema"], required: required, present: true}
	}
	for _, name := range sortedKeys(content) {
		if schema, ok := content[name].(map[string]any); ok {
			return media{schema: schema["schema"], required: required, present: true}
		}
	}
	return media{required: required, present: true}
}

func sortedKeys(object map[string]any) []string {
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func (docs documents) compareRequestBody(before, after any) []FieldChange {
	was, now := mediaSchema(docs.base, before), mediaSchema(docs.candidate, after)
	switch {
	case was.present && !now.present:
		return []FieldChange{{Kind: "request_body_removed", Class: ClassBreaking, Field: "body"}}
	case !was.present && now.present:
		return []FieldChange{{Kind: "request_body_added", Class: ClassAdditive, Field: "body"}}
	}
	wasFields, nowFields := FlattenSchema(docs.base, was.schema), FlattenSchema(docs.candidate, now.schema)
	if len(wasFields) > 1 && len(nowFields) <= 1 {
		return []FieldChange{{Kind: "request_body_undocumented", Class: ClassBreaking, Field: "body"}}
	}
	changes := []FieldChange{}
	if was.required != now.required {
		changes = append(changes, FieldChange{Kind: "request_body_required_changed", Class: classIf(now.required), Field: "body", Before: was.required, After: now.required})
	}
	compared := Comparison{Direction: Request, Prefix: "body"}.Compare(wasFields, nowFields)
	return append(changes, renamed(compared, "request_")...)
}

// compareResponses reports the status set and, for every success status both
// sides declare, the body's fields. Error bodies are the handled-error
// envelope's business, and a documented error status is not compared either.
func (docs documents) compareResponses(before, after any) []FieldChange {
	baseResponses, _ := before.(map[string]any)
	candidateResponses, _ := after.(map[string]any)
	changes := []FieldChange{}
	for _, status := range unionKeys(baseResponses, candidateResponses) {
		was, inBase := baseResponses[status]
		now, inCandidate := candidateResponses[status]
		switch {
		case inBase && !inCandidate:
			changes = append(changes, FieldChange{Kind: "status_removed", Class: statusClass(status, ClassBreaking), Field: status})
		case !inBase && inCandidate:
			changes = append(changes, FieldChange{Kind: "status_added", Class: statusClass(status, ClassAdditive), Field: status})
		case strings.HasPrefix(status, "2"):
			changes = append(changes, docs.compareResponseBody(status, was, now)...)
		}
	}
	return changes
}

func statusClass(status, success string) string {
	if strings.HasPrefix(status, "2") {
		return success
	}
	return ClassNotCompared
}

func (docs documents) compareResponseBody(status string, before, after any) []FieldChange {
	was, now := mediaSchema(docs.base, before), mediaSchema(docs.candidate, after)
	compared := Comparison{Direction: Response, Prefix: status}.Compare(FlattenSchema(docs.base, was.schema), FlattenSchema(docs.candidate, now.schema))
	return renamed(compared, "response_")
}

// String renders one change for a report line.
func (change FieldChange) String() string {
	text := fmt.Sprintf("%s %s %s", change.Class, change.Kind, change.Field)
	if change.Before != nil || change.After != nil {
		text += fmt.Sprintf(" (%v -> %v)", change.Before, change.After)
	}
	return text
}

package apidiff

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/openapidiff"
)

// SpecPath is the discovery endpoint every LangWatch API instance serves.
const SpecPath = "/api/openapi.json"

// Param is one resolved operation parameter.
type Param struct {
	Name     string         `json:"name"`
	In       string         `json:"in"`
	Required bool           `json:"required"`
	Schema   map[string]any `json:"schema,omitempty"`
	Example  any            `json:"example,omitempty"`
	HasValue bool           `json:"-"` // Example carries a usable value
}

// Operation is one OpenAPI operation reduced to what probing needs. The body
// schema has local $refs resolved. InA/InB record which side's served spec
// declares the operation; PathA/PathB record which alias FORM each side
// documents (empty when that side does not document the operation), because
// the branch auto-aliases /api/... to /api/v1/... — see CanonicalAliasPath.
type Operation struct {
	Method       string         `json:"method"`
	Path         string         `json:"path"` // canonical (bare) alias form
	OperationID  string         `json:"operationId,omitempty"`
	Params       []Param        `json:"params,omitempty"`
	BodySchema   map[string]any `json:"bodySchema,omitempty"`
	BodyRequired bool           `json:"bodyRequired,omitempty"`
	Security     []string       `json:"security,omitempty"` // scheme names, first requirement
	InA          bool           `json:"inA"`
	InB          bool           `json:"inB"`
	PathA        string         `json:"pathA,omitempty"` // documented form on side A
	PathB        string         `json:"pathB,omitempty"` // documented form on side B
}

// CanonicalAliasPath collapses the branch's /api ↔ /api/v1 auto-alias: an
// "/api/v1/<rest>" path is the same operation as "/api/<rest>", unless <rest>
// itself opens with a version-looking segment (v2, v3, …) — paths that carry
// their own versioning (/api/otel/v1/..., /api/scim/v2/...) never match the
// rule's prefix and pass through untouched.
func CanonicalAliasPath(path string) string {
	const prefix = "/api/v1/"
	if !strings.HasPrefix(path, prefix) {
		return path
	}
	rest := strings.TrimPrefix(path, prefix)
	first, _, _ := strings.Cut(rest, "/")
	if len(first) >= 2 && first[0] == 'v' && allDigits(first[1:]) {
		return path
	}
	return "/api/" + rest
}

func allDigits(text string) bool {
	for _, character := range text {
		if character < '0' || character > '9' {
			return false
		}
	}
	return len(text) > 0
}

// SidePaths returns the path form to probe on each side: the form that side
// documents (either alias form), or the canonical form when the side does not
// document the operation at all — probing it anyway catches
// undocumented-but-mounted routes.
func (operation Operation) SidePaths() (sideA, sideB string) {
	sideA = operation.PathA
	if sideA == "" {
		sideA = operation.Path
	}
	sideB = operation.PathB
	if sideB == "" {
		sideB = operation.Path
	}
	return sideA, sideB
}

// FetchSpec GETs the served OpenAPI document from a running instance and
// returns both the parsed document and the raw bytes.
func FetchSpec(ctx context.Context, client *http.Client, baseURL string) (map[string]any, []byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(baseURL, "/")+SpecPath, nil)
	if err != nil {
		return nil, nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, nil, fmt.Errorf("fetch spec from %s: %w", baseURL, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	if err != nil {
		return nil, nil, fmt.Errorf("read spec from %s: %w", baseURL, err)
	}
	if response.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("fetch spec from %s: status %d", baseURL, response.StatusCode)
	}
	document, err := decodeObject(body)
	if err != nil {
		return nil, nil, fmt.Errorf("parse spec from %s: %w", baseURL, err)
	}
	return document, body, nil
}

// SpecDiff writes both served documents to temp files and reuses
// openapidiff's Load and Diff unchanged for the spec-level comparison. Paths
// are alias-normalized first (CanonicalAliasPath), so the branch's
// /api ↔ /api/v1 auto-alias does not surface as removed+added noise. When one
// document carries BOTH forms of the same alias, the bare form wins — they
// are the same mounted operation by construction.
func SpecDiff(baseBytes, candidateBytes []byte, dir string) ([]openapidiff.Change, error) {
	baseBytes, err := normalizeAliasSpec(baseBytes)
	if err != nil {
		return nil, fmt.Errorf("base spec: %w", err)
	}
	candidateBytes, err = normalizeAliasSpec(candidateBytes)
	if err != nil {
		return nil, fmt.Errorf("candidate spec: %w", err)
	}
	basePath := filepath.Join(dir, "base.openapi.json")
	candidatePath := filepath.Join(dir, "candidate.openapi.json")
	if err := os.WriteFile(basePath, baseBytes, 0o600); err != nil {
		return nil, err
	}
	if err := os.WriteFile(candidatePath, candidateBytes, 0o600); err != nil {
		return nil, err
	}
	base, err := openapidiff.Load(basePath)
	if err != nil {
		return nil, fmt.Errorf("base spec: %w", err)
	}
	candidate, err := openapidiff.Load(candidatePath)
	if err != nil {
		return nil, fmt.Errorf("candidate spec: %w", err)
	}
	return openapidiff.Diff(base, candidate, "", "")
}

// SpecChangeKind maps an openapidiff change to its report kind.
func SpecChangeKind(change openapidiff.Change) string {
	switch change.Method {
	case "component":
		return "component_" + change.Kind
	case "<path-item>":
		return "path_item_" + change.Kind
	default:
		return "operation_" + change.Kind
	}
}

// Operations parses a served OpenAPI document into the operation model.
// Path-item and operation level parameters are merged, with operation level
// winning on (name, in) identity.
func Operations(document map[string]any) ([]Operation, error) {
	pathsValue, ok := document["paths"]
	if !ok {
		return nil, fmt.Errorf("spec has no paths")
	}
	paths, ok := pathsValue.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("spec paths is not an object")
	}
	operations := make([]Operation, 0)
	for _, path := range sortedKeys(paths) {
		item, ok := paths[path].(map[string]any)
		if !ok {
			continue
		}
		operations = append(operations, parsePathItem(document, path, item)...)
	}
	sortOperations(operations)
	return operations, nil
}

var httpMethods = []string{"get", "put", "post", "delete", "options", "head", "patch", "trace"}

// parsePathItem parses every operation one path item declares.
func parsePathItem(document map[string]any, path string, item map[string]any) []Operation {
	operations := make([]Operation, 0)
	for _, method := range httpMethods {
		operationObject, ok := item[method].(map[string]any)
		if !ok {
			continue
		}
		operations = append(operations, parseOperation(document, item, rawOperation{object: operationObject, method: method, path: path}))
	}
	return operations
}

func sortOperations(operations []Operation) {
	sort.Slice(operations, func(i, j int) bool {
		if operations[i].Path != operations[j].Path {
			return operations[i].Path < operations[j].Path
		}
		return operations[i].Method < operations[j].Method
	})
}

// rawOperation is one unparsed operation with its identity.
type rawOperation struct {
	object map[string]any
	method string
	path   string
}

func parseOperation(document, pathItem map[string]any, raw rawOperation) Operation {
	operation := Operation{Method: strings.ToUpper(raw.method), Path: raw.path}
	if id, ok := raw.object["operationId"].(string); ok {
		operation.OperationID = id
	}
	operation.Params = mergeParameters(document, pathItem["parameters"], raw.object["parameters"])
	operation.BodySchema, operation.BodyRequired = parseBodySchema(document, raw.object)
	operation.Security = operationSecurity(document, raw.object)
	return operation
}

// parseBodySchema resolves the operation's requestBody and returns its JSON
// body schema and required flag.
func parseBodySchema(document, operationObject map[string]any) (map[string]any, bool) {
	bodyValue, ok := operationObject["requestBody"]
	if !ok {
		return nil, false
	}
	body, ok := resolveRefs(document, bodyValue, map[string]bool{}).(map[string]any)
	if !ok {
		return nil, false
	}
	required, _ := body["required"].(bool)
	content, ok := body["content"].(map[string]any)
	if !ok {
		return nil, required
	}
	media, ok := content["application/json"].(map[string]any)
	if !ok {
		return nil, required
	}
	schema, _ := media["schema"].(map[string]any)
	return schema, required
}

// mergeParameters merges path-item and operation parameters, resolving
// parameter $refs. Operation level overrides path-item level on (in, name).
func mergeParameters(document map[string]any, levels ...any) []Param {
	set := &paramSet{index: map[string]int{}}
	for _, level := range levels {
		set.addLevel(document, level)
	}
	return set.params
}

// paramSet accumulates merged parameters with (in, name) identity.
type paramSet struct {
	params []Param
	index  map[string]int
}

func (set *paramSet) addLevel(document map[string]any, level any) {
	items, ok := level.([]any)
	if !ok {
		return
	}
	for _, item := range items {
		if param, ok := toParam(document, item); ok {
			set.add(param)
		}
	}
}

func (set *paramSet) add(param Param) {
	key := param.In + "\x00" + param.Name
	if prior, ok := set.index[key]; ok {
		set.params[prior] = param
		return
	}
	set.index[key] = len(set.params)
	set.params = append(set.params, param)
}

// toParam resolves one parameter entry (following $refs) into a Param.
func toParam(document map[string]any, item any) (Param, bool) {
	object, ok := resolveRefs(document, item, map[string]bool{}).(map[string]any)
	if !ok {
		return Param{}, false
	}
	name, _ := object["name"].(string)
	location, _ := object["in"].(string)
	if name == "" || location == "" {
		return Param{}, false
	}
	param := Param{Name: name, In: location}
	if required, ok := object["required"].(bool); ok {
		param.Required = required
	}
	if schema, ok := object["schema"].(map[string]any); ok {
		param.Schema = schema
	}
	if example, ok := paramExample(object); ok {
		param.Example = example
		param.HasValue = true
	}
	return param, true
}

// paramExample picks a usable value from a parameter's example, examples, or
// schema example/default, in that order.
func paramExample(object map[string]any) (any, bool) {
	if example, ok := object["example"]; ok {
		return example, true
	}
	if value, ok := exampleFromExamples(object); ok {
		return value, true
	}
	return exampleFromSchema(object)
}

// exampleFromExamples takes the first named example entry's value.
func exampleFromExamples(object map[string]any) (any, bool) {
	examples, ok := object["examples"].(map[string]any)
	if !ok {
		return nil, false
	}
	for _, key := range sortedKeys(examples) {
		entry, ok := examples[key].(map[string]any)
		if !ok {
			continue
		}
		if value, ok := entry["value"]; ok {
			return value, true
		}
	}
	return nil, false
}

// exampleFromSchema falls back to the parameter schema's example or default.
func exampleFromSchema(object map[string]any) (any, bool) {
	schema, ok := object["schema"].(map[string]any)
	if !ok {
		return nil, false
	}
	if example, ok := schema["example"]; ok {
		return example, true
	}
	if fallback, ok := schema["default"]; ok {
		return fallback, true
	}
	return nil, false
}

// operationSecurity returns the scheme names of the operation's first
// security requirement, falling back to the root security array. An empty
// result means the operation is callable without credentials.
func operationSecurity(document, operationObject map[string]any) []string {
	requirements, ok := operationObject["security"]
	if !ok {
		requirements, ok = document["security"]
	}
	if !ok {
		return nil
	}
	list, ok := requirements.([]any)
	if !ok || len(list) == 0 {
		return nil
	}
	first, ok := list[0].(map[string]any)
	if !ok {
		return nil
	}
	names := make([]string, 0, len(first))
	for name := range first {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// resolveRefs expands local "#/..." $refs recursively, cycle-safe: a cycle
// leaves the offending $ref object in place rather than looping forever.
func resolveRefs(document map[string]any, value any, seen map[string]bool) any {
	return refResolver{document: document, seen: seen}.resolve(value)
}

// refResolver carries the document and the active $ref chain through
// resolution.
type refResolver struct {
	document map[string]any
	seen     map[string]bool
}

func (resolver refResolver) resolve(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return resolver.resolveObject(typed)
	case []any:
		resolved := make([]any, len(typed))
		for index, item := range typed {
			resolved[index] = resolver.resolve(item)
		}
		return resolved
	default:
		return value
	}
}

func (resolver refResolver) resolveObject(object map[string]any) any {
	reference, isRef := object["$ref"].(string)
	if isRef && strings.HasPrefix(reference, "#/") {
		return resolver.resolveReference(object, reference)
	}
	resolved := make(map[string]any, len(object))
	for key, child := range object {
		resolved[key] = resolver.resolve(child)
	}
	return resolved
}

func (resolver refResolver) resolveReference(object map[string]any, reference string) any {
	if resolver.seen[reference] {
		return object
	}
	target, ok := pointerValue(resolver.document, reference)
	if !ok {
		return object
	}
	return resolver.descend(reference).resolve(target)
}

// descend returns the resolver one $ref hop deeper, with the reference added
// to the seen chain.
func (resolver refResolver) descend(reference string) refResolver {
	nextSeen := make(map[string]bool, len(resolver.seen)+1)
	for key := range resolver.seen {
		nextSeen[key] = true
	}
	nextSeen[reference] = true
	return refResolver{document: resolver.document, seen: nextSeen}
}

// pointerValue resolves a local JSON pointer ("#/components/schemas/Foo")
// against the document, honoring ~0/~1 escapes.
func pointerValue(document map[string]any, pointer string) (any, bool) {
	current := any(document)
	for _, segment := range strings.Split(strings.TrimPrefix(pointer, "#/"), "/") {
		segment = strings.ReplaceAll(strings.ReplaceAll(segment, "~1", "/"), "~0", "~")
		object, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		current, ok = object[segment]
		if !ok {
			return nil, false
		}
	}
	return current, true
}

// normalizeAliasSpec rewrites a served document's paths to canonical alias
// form and re-encodes it. On a same-document alias collision the bare form
// wins.
func normalizeAliasSpec(data []byte) ([]byte, error) {
	document, err := decodeObject(data)
	if err != nil {
		return nil, err
	}
	paths, ok := document["paths"].(map[string]any)
	if !ok {
		return data, nil
	}
	normalized := make(map[string]any, len(paths))
	for _, path := range sortedKeys(paths) {
		canonical := CanonicalAliasPath(path)
		if _, exists := normalized[canonical]; exists && path != canonical {
			continue // alias duplicate; the bare form wins collisions
		}
		normalized[canonical] = paths[path]
	}
	document["paths"] = normalized
	return json.Marshal(document)
}

// SecuritySchemes unions the components.securitySchemes maps of the given
// documents; the first document wins on a name collision.
func SecuritySchemes(documents ...map[string]any) map[string]map[string]any {
	schemes := map[string]map[string]any{}
	for _, document := range documents {
		collectSchemes(document, schemes)
	}
	return schemes
}

func collectSchemes(document map[string]any, schemes map[string]map[string]any) {
	components, ok := document["components"].(map[string]any)
	if !ok {
		return
	}
	entries, ok := components["securitySchemes"].(map[string]any)
	if !ok {
		return
	}
	for name, value := range entries {
		scheme, ok := value.(map[string]any)
		if !ok {
			continue
		}
		if _, exists := schemes[name]; !exists {
			schemes[name] = scheme
		}
	}
}

// UnionOperations merges both sides' operation lists keyed by method and
// CANONICAL alias path (see CanonicalAliasPath), sorted by path then method.
// The merged operation's Path is the canonical bare form; PathA/PathB record
// the form each side documents, preferring the /api/v1 form when a side
// documents both. The probing definition (params, body schema, security)
// prefers side A's spec and falls back to side B's.
func UnionOperations(a, b []Operation) []Operation {
	merger := &operationMerger{merged: map[operationKey]*Operation{}}
	merger.ingest(b, false)
	merger.ingest(a, true)
	result := make([]Operation, 0, len(merger.order))
	for _, id := range merger.order {
		result = append(result, *merger.merged[id])
	}
	sortOperations(result)
	return result
}

type operationKey struct {
	method, path string
}

type operationMerger struct {
	merged map[operationKey]*Operation
	order  []operationKey
}

func (merger *operationMerger) ingest(operations []Operation, isA bool) {
	for index := range operations {
		op := operations[index]
		original := op.Path
		op.Path = CanonicalAliasPath(original)
		id := operationKey{op.Method, op.Path}
		if existing, ok := merger.merged[id]; ok {
			merger.mergeInto(existing, original, isA)
			continue
		}
		merger.setForm(&op, original, isA)
		merger.merged[id] = &op
		merger.order = append(merger.order, id)
	}
}

// mergeInto folds a duplicate (alias-form) operation into the merged entry:
// presence flags accumulate, and the side's documented form prefers /api/v1.
func (merger *operationMerger) mergeInto(existing *Operation, form string, isA bool) {
	if isA {
		existing.InA = true
		existing.PathA = preferredForm(existing.PathA, form)
		return
	}
	existing.InB = true
	existing.PathB = preferredForm(existing.PathB, form)
}

// setForm marks a first-seen operation's side presence and records the
// ORIGINAL documented path, so probing targets exactly what that side's spec
// declares.
func (merger *operationMerger) setForm(op *Operation, form string, isA bool) {
	if isA {
		op.InA = true
		op.PathA = form
		return
	}
	op.InB = true
	op.PathB = form
}

// preferredForm picks the /api/v1 form when both alias forms are documented.
func preferredForm(current, candidate string) string {
	if current == "" || strings.HasPrefix(candidate, "/api/v1/") {
		return candidate
	}
	return current
}

func decodeObject(data []byte) (map[string]any, error) {
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected JSON object")
	}
	return object, nil
}

func sortedKeys(object map[string]any) []string {
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

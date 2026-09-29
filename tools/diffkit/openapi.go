package diffkit

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"

	"encoding/json"
)

// SpecPath is where the API serves its OpenAPI document.
const SpecPath = "/api/openapi.json"

// Copied from tools/apidiff/spec.go so the fuzzer parses the same way; switch
// apidiff onto diffkit later. Trimmed to what a single-stack fuzzer needs
// (no main-vs-branch alias/side bookkeeping).

// Param is one resolved operation parameter.
type Param struct {
	Name     string         `json:"name"`
	In       string         `json:"in"`
	Required bool           `json:"required"`
	Schema   map[string]any `json:"schema,omitempty"`
	Example  any            `json:"example,omitempty"`
	HasValue bool           `json:"-"`
}

// Operation is one OpenAPI operation reduced to what probing needs, with body
// $refs resolved.
type Operation struct {
	Method       string         `json:"method"`
	Path         string         `json:"path"`
	OperationID  string         `json:"operationId,omitempty"`
	Params       []Param        `json:"params,omitempty"`
	BodySchema   map[string]any `json:"bodySchema,omitempty"`
	BodyRequired bool           `json:"bodyRequired,omitempty"`
	Security     []string       `json:"security,omitempty"`
}

// FetchSpec reads and decodes the OpenAPI document served at baseURL.
func FetchSpec(ctx context.Context, client *http.Client, baseURL string) (map[string]any, []byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(baseURL, "/")+SpecPath, nil)
	if err != nil {
		return nil, nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, nil, fmt.Errorf("fetch spec from %s: %w", baseURL, err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	if err != nil {
		return nil, nil, fmt.Errorf("read spec from %s: %w", baseURL, err)
	}
	if response.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("spec from %s: status %d", baseURL, response.StatusCode)
	}
	document, err := decodeObject(body)
	if err != nil {
		return nil, nil, fmt.Errorf("parse spec from %s: %w", baseURL, err)
	}
	return document, body, nil
}

// Operations parses every operation in an OpenAPI document, sorted.
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

func mergeParameters(document map[string]any, levels ...any) []Param {
	set := &paramSet{index: map[string]int{}}
	for _, level := range levels {
		set.addLevel(document, level)
	}
	return set.params
}

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

func paramExample(object map[string]any) (any, bool) {
	if example, ok := object["example"]; ok {
		return example, true
	}
	if value, ok := exampleFromExamples(object); ok {
		return value, true
	}
	return exampleFromSchema(object)
}

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

// operationSecurity returns the scheme names of the operation's first security
// requirement, falling back to the root security array; empty means callable
// without credentials.
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

func resolveRefs(document map[string]any, value any, seen map[string]bool) any {
	return refResolver{document: document, seen: seen}.resolve(value)
}

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

func (resolver refResolver) descend(reference string) refResolver {
	seen := make(map[string]bool, len(resolver.seen)+1)
	for key := range resolver.seen {
		seen[key] = true
	}
	seen[reference] = true
	return refResolver{document: resolver.document, seen: seen}
}

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

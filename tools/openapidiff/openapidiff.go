package openapidiff

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
)

// Change is one semantic difference. Fields contains before/after values for
// each changed semantic field. Added and removed values are represented by an
// "operation" or "value" field rather than by an empty marker.
type Change struct {
	Kind   string            `json:"kind"`
	Path   string            `json:"path"`
	Method string            `json:"method"`
	Fields map[string][2]any `json:"fields,omitempty"`
}

var componentKinds = map[string]bool{
	"schemas": true, "parameters": true, "requestBodies": true, "responses": true,
	"headers": true, "securitySchemes": true, "examples": true, "links": true,
	"callbacks": true, "pathItems": true,
}

// IsHTTPMethod reports whether method is one of the standard OpenAPI methods.
func IsHTTPMethod(method string) bool {
	switch strings.ToLower(method) {
	case "get", "put", "post", "delete", "options", "head", "patch", "trace":
		return true
	default:
		return false
	}
}

func obj(value any) (map[string]any, error) {
	object, ok := value.(map[string]any)
	if !ok || object == nil {
		return nil, errors.New("expected JSON object")
	}
	return object, nil
}

// Load reads and structurally validates an OpenAPI 3 JSON document. It does
// not attempt full OpenAPI Schema or URI validation.
func Load(path string) (map[string]any, error) {
	return load(path, false)
}

// LoadStrict reads a document and also rejects empty Responses Objects.
func LoadStrict(path string) (map[string]any, error) {
	return load(path, true)
}

func load(path string, strict bool) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var document any
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, err
	}
	root, err := obj(document)
	if err != nil {
		return nil, fmt.Errorf("root: %w", err)
	}
	if err := validateDocument(root, strict); err != nil {
		return nil, err
	}
	return root, nil
}

func validateDocument(document map[string]any, strict bool) error {
	version, ok := document["openapi"].(string)
	if !ok || !validOpenAPIVersion(version) {
		return errors.New("openapi must be an OpenAPI 3 version string")
	}
	pathsValue, ok := document["paths"]
	if !ok {
		return errors.New("paths is required")
	}
	paths, err := obj(pathsValue)
	if err != nil {
		return fmt.Errorf("paths: %w", err)
	}
	for path, value := range paths {
		if !strings.HasPrefix(path, "/") {
			return fmt.Errorf("paths.%s: path must start with /", path)
		}
		item, err := obj(value)
		if err != nil {
			return fmt.Errorf("path %s: %w", path, err)
		}
		if err := validatePathItem(path, item); err != nil {
			return err
		}
	}
	if value, ok := document["components"]; ok {
		if err := validateComponents(value); err != nil {
			return err
		}
	}
	if err := validateLocalReferences(document, document); err != nil {
		return err
	}
	if value, ok := document["security"]; ok {
		if err := validateSecurity(value, "security"); err != nil {
			return err
		}
	}
	if value, ok := document["servers"]; ok {
		if err := validateServers(value, "servers"); err != nil {
			return err
		}
	}
	if strict {
		if err := validateNonEmptyResponses(document); err != nil {
			return err
		}
	}
	return nil
}

func validateNonEmptyResponses(document map[string]any) error {
	return validateNonEmptyResponsesAt(document, "document")
}

func validateNonEmptyResponsesAt(value any, location string) error {
	switch value := value.(type) {
	case map[string]any:
		for key, child := range value {
			if key == "responses" {
				responses, ok := child.(map[string]any)
				if ok && len(responses) == 0 {
					return fmt.Errorf("%s.responses: must not be empty in strict mode", location)
				}
			}
			if err := validateNonEmptyResponsesAt(child, location+"."+key); err != nil {
				return err
			}
		}
	case []any:
		for index, child := range value {
			if err := validateNonEmptyResponsesAt(child, location+"["+strconv.Itoa(index)+"]"); err != nil {
				return err
			}
		}
	}
	return nil
}

func validOpenAPIVersion(version string) bool {
	parts := strings.Split(version, ".")
	if len(parts) != 3 || parts[0] != "3" {
		return false
	}
	for _, part := range parts[1:] {
		if part == "" {
			return false
		}
		for _, character := range part {
			if character < '0' || character > '9' {
				return false
			}
		}
	}
	return true
}

func validatePathItem(path string, item map[string]any) error {
	for key, value := range item {
		if strings.HasPrefix(key, "x-") {
			continue
		}
		switch key {
		case "$ref":
			if _, ok := value.(string); !ok {
				return fmt.Errorf("path %s: $ref must be a string", path)
			}
		case "summary", "description":
			if _, ok := value.(string); !ok {
				return fmt.Errorf("path %s: %s must be a string", path, key)
			}
		case "servers":
			if err := validateServers(value, "path "+path+" servers"); err != nil {
				return err
			}
		case "parameters":
			if err := validateParameters(value, "path "+path+" parameters"); err != nil {
				return err
			}
		default:
			if !IsHTTPMethod(key) {
				return fmt.Errorf("path %s: unknown path-item field %q", path, key)
			}
			operation, err := obj(value)
			if err != nil {
				return fmt.Errorf("operation %s %s: %w", key, path, err)
			}
			if err := validateOperation(path, key, operation); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateLocalReferences(value any, document map[string]any) error {
	return validateLocalReferencesAt(value, document, "document")
}

func validateLocalReferencesAt(value any, document map[string]any, location string) error {
	switch value := value.(type) {
	case map[string]any:
		for key, child := range value {
			if key == "$ref" {
				reference, ok := child.(string)
				if !ok {
					return fmt.Errorf("%s.$ref must be a string", location)
				}
				if strings.HasPrefix(reference, "#/components/") {
					id, ok := componentID(reference)
					if !ok {
						return fmt.Errorf("%s.$ref is not a supported component reference", location)
					}
					if _, ok := componentValue(document, id); !ok {
						return fmt.Errorf("%s.$ref target %s does not exist", location, id)
					}
				}
			}
			if err := validateLocalReferencesAt(child, document, location+"."+key); err != nil {
				return err
			}
		}
	case []any:
		for index, child := range value {
			if err := validateLocalReferencesAt(child, document, location+"["+strconv.Itoa(index)+"]"); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateOperation(path, method string, operation map[string]any) error {
	responses, ok := operation["responses"]
	if !ok {
		return fmt.Errorf("operation %s %s: responses is required", method, path)
	}
	if err := validateResponses(responses, "operation "+method+" "+path+" responses"); err != nil {
		return err
	}
	for key, value := range operation {
		if strings.HasPrefix(key, "x-") {
			continue
		}
		switch key {
		case "operationId", "summary", "description":
			if _, ok := value.(string); !ok {
				return fmt.Errorf("operation %s %s: %s must be a string", method, path, key)
			}
		case "tags":
			if err := validateStringArray(value, "operation "+method+" "+path+" tags"); err != nil {
				return err
			}
		case "deprecated":
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("operation %s %s: deprecated must be boolean", method, path)
			}
		case "parameters":
			if err := validateParameters(value, "operation "+method+" "+path+" parameters"); err != nil {
				return err
			}
		case "requestBody":
			if err := validateObjectOrRef(value, "operation "+method+" "+path+" requestBody"); err != nil {
				return err
			}
			if requestBody, _ := obj(value); requestBody != nil {
				if content, ok := requestBody["content"]; ok {
					if err := validateContent(content, "operation "+method+" "+path+" requestBody.content"); err != nil {
						return err
					}
				}
			}
		case "security":
			if err := validateSecurity(value, "operation "+method+" "+path+" security"); err != nil {
				return err
			}
		case "servers":
			if err := validateServers(value, "operation "+method+" "+path+" servers"); err != nil {
				return err
			}
		case "callbacks":
			if err := validateObjectMap(value, "operation "+method+" "+path+" callbacks"); err != nil {
				return err
			}
		case "externalDocs":
			if err := validateObjectOrRef(value, "operation "+method+" "+path+" externalDocs"); err != nil {
				return err
			}
		case "responses":
			// Validated above.
		default:
			return fmt.Errorf("operation %s %s: unknown operation field %q", method, path, key)
		}
	}
	return nil
}

func validateObjectMap(value any, label string) error {
	object, err := obj(value)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	for key, item := range object {
		if err := validateObjectOrRef(item, label+"."+key); err != nil {
			return err
		}
	}
	return nil
}

func validateObjectOrRef(value any, label string) error {
	object, err := obj(value)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	if reference, ok := object["$ref"]; ok {
		if _, ok := reference.(string); !ok {
			return fmt.Errorf("%s.$ref must be a string", label)
		}
	}
	return nil
}

func validateSchemaOrRef(value any, label string) error {
	if _, ok := value.(bool); ok {
		return nil
	}
	return validateObjectOrRef(value, label)
}

func validateParameters(value any, label string) error {
	items, ok := value.([]any)
	if !ok {
		return fmt.Errorf("%s: expected array", label)
	}
	seen := map[string]bool{}
	for index, item := range items {
		object, err := obj(item)
		if err != nil {
			return fmt.Errorf("%s[%d]: %w", label, index, err)
		}
		if reference, ok := object["$ref"]; ok {
			if _, ok := reference.(string); !ok {
				return fmt.Errorf("%s[%d].$ref must be a string", label, index)
			}
			continue
		}
		name, nameOK := object["name"].(string)
		location, locationOK := object["in"].(string)
		if !nameOK || name == "" || !locationOK || location == "" {
			return fmt.Errorf("%s[%d]: parameter requires name and in", label, index)
		}
		key := location + "\x00" + name
		if seen[key] {
			return fmt.Errorf("%s[%d]: duplicate parameter %s in %s", label, index, name, location)
		}
		seen[key] = true
		if location == "path" {
			required, ok := object["required"].(bool)
			if !ok || !required {
				return fmt.Errorf("%s[%d]: path parameter must be required", label, index)
			}
		}
		if schema, ok := object["schema"]; ok {
			if err := validateSchemaOrRef(schema, label+"["+strconv.Itoa(index)+"].schema"); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateResponses(value any, label string) error {
	responses, err := obj(value)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	for key, response := range responses {
		if err := validateResponse(response, label+"."+key); err != nil {
			return err
		}
	}
	return nil
}

func validateResponse(value any, label string) error {
	if err := validateObjectOrRef(value, label); err != nil {
		return err
	}
	response, _ := obj(value)
	if content, ok := response["content"]; ok {
		if err := validateContent(content, label+".content"); err != nil {
			return err
		}
	}
	return nil
}

func validateContent(value any, label string) error {
	content, err := obj(value)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	for mediaType, mediaValue := range content {
		media, err := obj(mediaValue)
		if err != nil {
			return fmt.Errorf("%s.%s: %w", label, mediaType, err)
		}
		if schema, ok := media["schema"]; ok {
			if err := validateSchemaOrRef(schema, label+"."+mediaType+".schema"); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateServers(value any, label string) error {
	servers, ok := value.([]any)
	if !ok {
		return fmt.Errorf("%s: expected array", label)
	}
	for index, server := range servers {
		object, err := obj(server)
		if err != nil {
			return fmt.Errorf("%s[%d]: %w", label, index, err)
		}
		if _, ok := object["url"].(string); !ok {
			return fmt.Errorf("%s[%d]: url must be a string", label, index)
		}
	}
	return nil
}

func validateSecurity(value any, label string) error {
	requirements, ok := value.([]any)
	if !ok {
		return fmt.Errorf("%s: expected array", label)
	}
	for index, requirement := range requirements {
		object, err := obj(requirement)
		if err != nil {
			return fmt.Errorf("%s[%d]: %w", label, index, err)
		}
		for scheme, scopes := range object {
			if err := validateStringArray(scopes, label+"["+strconv.Itoa(index)+"]."+scheme); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateStringArray(value any, label string) error {
	items, ok := value.([]any)
	if !ok {
		return fmt.Errorf("%s: expected string array", label)
	}
	for index, item := range items {
		if _, ok := item.(string); !ok {
			return fmt.Errorf("%s[%d]: expected string", label, index)
		}
	}
	return nil
}

func validateComponents(value any) error {
	components, err := obj(value)
	if err != nil {
		return fmt.Errorf("components: %w", err)
	}
	for kind, entries := range components {
		if strings.HasPrefix(kind, "x-") {
			continue
		}
		if !componentKinds[kind] {
			return fmt.Errorf("components: unknown component kind %q", kind)
		}
		if entries == nil {
			continue
		}
		if emptyEntries, ok := entries.(map[string]any); ok && emptyEntries == nil {
			continue
		}
		entryMap, err := obj(entries)
		if err != nil {
			return fmt.Errorf("components.%s: %w", kind, err)
		}
		for name, entry := range entryMap {
			validateEntry := validateObjectOrRef
			if kind == "schemas" {
				validateEntry = validateSchemaOrRef
			}
			if kind == "pathItems" {
				pathItem, err := obj(entry)
				if err != nil {
					return fmt.Errorf("components.%s.%s: %w", kind, name, err)
				}
				if err := validatePathItem("components.pathItems."+name, pathItem); err != nil {
					return err
				}
				continue
			}
			if err := validateEntry(entry, "components."+kind+"."+name); err != nil {
				return err
			}
			if kind == "responses" {
				if err := validateResponse(entry, "components.responses."+name); err != nil {
					return err
				}
			}
			if kind == "headers" {
				header, _ := obj(entry)
				if schema, ok := header["schema"]; ok {
					if err := validateSchemaOrRef(schema, "components.headers."+name+".schema"); err != nil {
						return err
					}
				}
			}
			if kind == "parameters" {
				parameter, _ := obj(entry)
				if schema, ok := parameter["schema"]; ok {
					if err := validateSchemaOrRef(schema, "components.parameters."+name+".schema"); err != nil {
						return err
					}
				}
			}
			if kind == "requestBodies" {
				requestBody, _ := obj(entry)
				if content, ok := requestBody["content"]; ok {
					if err := validateContent(content, "components.requestBodies."+name+".content"); err != nil {
						return err
					}
				}
			}
		}
	}
	return nil
}

func equal(left, right any) bool {
	return reflect.DeepEqual(left, right)
}

func mapKeys(left, right map[string]any) []string {
	keys := make(map[string]bool, len(left)+len(right))
	for key := range left {
		keys[key] = true
	}
	for key := range right {
		keys[key] = true
	}
	result := make([]string, 0, len(keys))
	for key := range keys {
		result = append(result, key)
	}
	sort.Strings(result)
	return result
}

func metadata(item map[string]any) map[string]any {
	result := make(map[string]any)
	for key, value := range item {
		if strings.HasPrefix(key, "x-") || key == "$ref" || key == "summary" || key == "description" || key == "servers" || key == "parameters" {
			result[key] = value
		}
	}
	return result
}

func effectiveMetadata(raw, resolved map[string]any) map[string]any {
	result := metadata(resolved)
	if reference, ok := raw["$ref"]; ok {
		result["$ref"] = reference
	}
	return result
}

func extensions(operation map[string]any) map[string]any {
	result := make(map[string]any)
	for key, value := range operation {
		if strings.HasPrefix(key, "x-") {
			result[key] = value
		}
	}
	return result
}

func parameterIdentity(document map[string]any, item any) string {
	return parameterIdentitySeen(document, item, make(map[string]bool))
}

func parameterIdentitySeen(document map[string]any, item any, seen map[string]bool) string {
	object, ok := item.(map[string]any)
	if !ok {
		return ""
	}
	name, nameOK := object["name"].(string)
	location, locationOK := object["in"].(string)
	if nameOK && locationOK {
		return location + "\x00" + name
	}
	reference, ok := object["$ref"].(string)
	if !ok {
		return ""
	}
	id, ok := componentID(reference)
	if !ok || !strings.HasPrefix(id, "#/components/parameters/") {
		return ""
	}
	if seen[id] {
		return ""
	}
	seen[id] = true
	value, ok := componentValue(document, id)
	if !ok {
		return ""
	}
	return parameterIdentitySeen(document, value, seen)
}

func effectiveParameters(document, pathItem, operation map[string]any) any {
	result := make([]any, 0)
	seen := map[string]bool{}
	appendParameters := func(value any) {
		items, ok := value.([]any)
		if !ok {
			return
		}
		for _, item := range items {
			_, ok := item.(map[string]any)
			if !ok {
				result = append(result, item)
				continue
			}
			key := parameterIdentity(document, item)
			if key == "" {
				result = append(result, item)
				continue
			}
			if seen[key] {
				for index := range result {
					prior, _ := result[index].(map[string]any)
					if key == parameterIdentity(document, prior) {
						result[index] = item
						break
					}
				}
				continue
			}
			seen[key] = true
			result = append(result, item)
		}
	}
	appendParameters(pathItem["parameters"])
	appendParameters(operation["parameters"])
	return result
}

func effectiveValue(root, pathItem, operation map[string]any, key string) (any, bool) {
	if value, ok := operation[key]; ok {
		return value, true
	}
	if value, ok := pathItem[key]; ok {
		return value, true
	}
	if value, ok := root[key]; ok {
		return value, true
	}
	return nil, false
}

func operationSnapshot(root, pathItem, operation map[string]any) map[string]any {
	result := make(map[string]any)
	for _, key := range []string{"operationId", "tags", "summary", "description", "deprecated", "requestBody", "responses", "callbacks", "externalDocs"} {
		if value, ok := operation[key]; ok {
			result[key] = value
		}
	}
	result["parameters"] = effectiveParameters(root, pathItem, operation)
	if security, ok := effectiveValue(root, pathItem, operation, "security"); ok {
		result["security"] = security
	}
	if servers, ok := effectiveValue(root, pathItem, operation, "servers"); ok {
		result["servers"] = servers
	}
	if ext := extensions(operation); len(ext) > 0 {
		result["extensions"] = ext
	}
	return result
}

func operationFields(base, candidate map[string]any) map[string][2]any {
	fields := make(map[string][2]any)
	for _, key := range mapKeys(base, candidate) {
		if !equal(base[key], candidate[key]) {
			fields[key] = [2]any{base[key], candidate[key]}
		}
	}
	return fields
}

func hasOperation(pathItem map[string]any, method string) bool {
	_, ok := pathItem[method]
	return ok
}

func componentID(reference string) (string, bool) {
	if !strings.HasPrefix(reference, "#/components/") {
		return "", false
	}
	parts := strings.Split(strings.TrimPrefix(reference, "#/components/"), "/")
	if len(parts) < 2 {
		return "", false
	}
	kind, ok := decodePointer(parts[0])
	if !ok || !componentKinds[kind] {
		return "", false
	}
	name, ok := decodePointer(parts[1])
	if !ok || name == "" {
		return "", false
	}
	return "#/components/" + escapePointer(kind) + "/" + escapePointer(name), true
}

func decodePointer(value string) (string, bool) {
	var result strings.Builder
	for index := 0; index < len(value); index++ {
		if value[index] != '~' {
			result.WriteByte(value[index])
			continue
		}
		if index+1 >= len(value) || (value[index+1] != '0' && value[index+1] != '1') {
			return "", false
		}
		if value[index+1] == '0' {
			result.WriteByte('~')
		} else {
			result.WriteByte('/')
		}
		index++
	}
	return result.String(), true
}

func escapePointer(value string) string {
	value = strings.ReplaceAll(value, "~", "~0")
	return strings.ReplaceAll(value, "/", "~1")
}

func collectReferences(value any, references map[string]bool) {
	switch value := value.(type) {
	case map[string]any:
		for key, child := range value {
			if key == "$ref" {
				if reference, ok := child.(string); ok {
					if id, ok := componentID(reference); ok {
						references[id] = true
					}
				}
			}
			collectReferences(child, references)
		}
	case []any:
		for _, child := range value {
			collectReferences(child, references)
		}
	}
}

func collectSecurityReferences(value any, references map[string]bool) {
	requirements, ok := value.([]any)
	if !ok {
		return
	}
	for _, requirement := range requirements {
		object, ok := requirement.(map[string]any)
		if !ok {
			continue
		}
		for scheme := range object {
			references["#/components/securitySchemes/"+escapePointer(scheme)] = true
		}
	}
}

func componentValue(document map[string]any, id string) (any, bool) {
	if !strings.HasPrefix(id, "#/components/") {
		return nil, false
	}
	parts := strings.Split(strings.TrimPrefix(id, "#/components/"), "/")
	if len(parts) != 2 {
		return nil, false
	}
	kind, ok := decodePointer(parts[0])
	if !ok {
		return nil, false
	}
	name, ok := decodePointer(parts[1])
	if !ok {
		return nil, false
	}
	components, ok := document["components"].(map[string]any)
	if !ok {
		return nil, false
	}
	entries, ok := components[kind].(map[string]any)
	if !ok {
		return nil, false
	}
	value, ok := entries[name]
	return value, ok
}

func resolvePathItem(document map[string]any, item map[string]any) (map[string]any, error) {
	return resolvePathItemSeen(document, item, make(map[string]bool))
}

func resolvePathItemSeen(document map[string]any, item map[string]any, seen map[string]bool) (map[string]any, error) {
	resolved := make(map[string]any, len(item))
	for key, value := range item {
		resolved[key] = value
	}
	reference, ok := item["$ref"].(string)
	if !ok || !strings.HasPrefix(reference, "#/components/") {
		return resolved, nil
	}
	id, ok := componentID(reference)
	if !ok || !strings.HasPrefix(id, "#/components/pathItems/") {
		return nil, fmt.Errorf("path-item $ref %q must target components.pathItems", reference)
	}
	if seen[id] {
		return nil, fmt.Errorf("path-item $ref cycle at %s", id)
	}
	seen[id] = true
	target, ok := componentValue(document, id)
	if !ok {
		return nil, fmt.Errorf("path-item $ref target %s does not exist", id)
	}
	targetItem, err := obj(target)
	if err != nil {
		return nil, fmt.Errorf("path-item $ref target %s: %w", id, err)
	}
	resolvedTarget, err := resolvePathItemSeen(document, targetItem, seen)
	if err != nil {
		return nil, err
	}
	for key, value := range resolvedTarget {
		resolved[key] = value
	}
	for key, value := range item {
		if key != "$ref" {
			resolved[key] = value
		}
	}
	return resolved, nil
}

func reachableComponents(base, candidate map[string]any, roots map[string]bool) []string {
	seen := make(map[string]bool, len(roots))
	for root := range roots {
		seen[root] = true
	}
	for changed := true; changed; {
		changed = false
		for id := range seen {
			for _, document := range []map[string]any{base, candidate} {
				if value, ok := componentValue(document, id); ok {
					before := len(seen)
					collectReferences(value, seen)
					changed = changed || len(seen) != before
				}
			}
		}
	}
	result := make([]string, 0, len(seen))
	for id := range seen {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

func snapshotSecurity(value any) any {
	snapshot, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return snapshot["security"]
}

// Diff compares selected operations and the components reachable from them.
func Diff(base, candidate map[string]any, prefix, method string) ([]Change, error) {
	method = strings.ToLower(method)
	if method != "" && !IsHTTPMethod(method) {
		return nil, fmt.Errorf("invalid HTTP method %q", method)
	}
	if err := validateDocument(base, false); err != nil {
		return nil, fmt.Errorf("base: %w", err)
	}
	if err := validateDocument(candidate, false); err != nil {
		return nil, fmt.Errorf("candidate: %w", err)
	}
	basePaths, err := obj(base["paths"])
	if err != nil {
		return nil, fmt.Errorf("base paths: %w", err)
	}
	candidatePaths, err := obj(candidate["paths"])
	if err != nil {
		return nil, fmt.Errorf("candidate paths: %w", err)
	}
	baseRoot := base
	candidateRoot := candidate
	roots := make(map[string]bool)
	changes := make([]Change, 0)

	for _, path := range mapKeys(basePaths, candidatePaths) {
		if prefix != "" && !strings.HasPrefix(path, prefix) {
			continue
		}
		baseValue, basePresent := basePaths[path]
		candidateValue, candidatePresent := candidatePaths[path]
		var baseRawItem, candidateRawItem map[string]any
		var baseItem, candidateItem map[string]any
		if basePresent {
			baseRawItem, err = obj(baseValue)
			if err != nil {
				return nil, fmt.Errorf("path %s: %w", path, err)
			}
			baseItem, err = resolvePathItem(base, baseRawItem)
			if err != nil {
				return nil, fmt.Errorf("path %s: %w", path, err)
			}
			if method == "" || hasOperation(baseItem, method) {
				collectReferences(metadata(baseRawItem), roots)
				collectReferences(metadata(baseItem), roots)
			}
		}
		if candidatePresent {
			candidateRawItem, err = obj(candidateValue)
			if err != nil {
				return nil, fmt.Errorf("path %s: %w", path, err)
			}
			candidateItem, err = resolvePathItem(candidate, candidateRawItem)
			if err != nil {
				return nil, fmt.Errorf("path %s: %w", path, err)
			}
			if method == "" || hasOperation(candidateItem, method) {
				collectReferences(metadata(candidateRawItem), roots)
				collectReferences(metadata(candidateItem), roots)
			}
		}
		if method == "" && basePresent && candidatePresent {
			fields := operationFields(effectiveMetadata(baseRawItem, baseItem), effectiveMetadata(candidateRawItem, candidateItem))
			if len(fields) > 0 {
				changes = append(changes, Change{Kind: "changed", Path: path, Method: "<path-item>", Fields: fields})
			}
		}

		for _, operationMethod := range []string{"get", "put", "post", "delete", "options", "head", "patch", "trace"} {
			if method != "" && operationMethod != method {
				continue
			}
			baseOperationValue, baseOperationPresent := baseItem[operationMethod]
			candidateOperationValue, candidateOperationPresent := candidateItem[operationMethod]
			var baseOperation, candidateOperation map[string]any
			if baseOperationPresent {
				baseOperation, err = obj(baseOperationValue)
				if err != nil {
					return nil, fmt.Errorf("operation %s %s: %w", operationMethod, path, err)
				}
				collectReferences(baseOperation, roots)
			}
			if candidateOperationPresent {
				candidateOperation, err = obj(candidateOperationValue)
				if err != nil {
					return nil, fmt.Errorf("operation %s %s: %w", operationMethod, path, err)
				}
				collectReferences(candidateOperation, roots)
			}
			if baseOperationPresent && candidateOperationPresent {
				before := operationSnapshot(baseRoot, baseItem, baseOperation)
				after := operationSnapshot(candidateRoot, candidateItem, candidateOperation)
				collectSecurityReferences(before["security"], roots)
				collectSecurityReferences(after["security"], roots)
				fields := operationFields(before, after)
				if len(fields) > 0 {
					changes = append(changes, Change{Kind: "changed", Path: path, Method: operationMethod, Fields: fields})
				}
			} else if baseOperationPresent || candidateOperationPresent {
				kind := "removed"
				before, after := any(nil), any(nil)
				if baseOperationPresent {
					before = operationSnapshot(baseRoot, baseItem, baseOperation)
				} else {
					kind = "added"
				}
				if candidateOperationPresent {
					after = operationSnapshot(candidateRoot, candidateItem, candidateOperation)
				}
				collectSecurityReferences(snapshotSecurity(before), roots)
				collectSecurityReferences(snapshotSecurity(after), roots)
				changes = append(changes, Change{Kind: kind, Path: path, Method: operationMethod, Fields: map[string][2]any{"operation": {before, after}}})
			}
		}
	}

	for _, id := range reachableComponents(base, candidate, roots) {
		before, beforeOK := componentValue(base, id)
		after, afterOK := componentValue(candidate, id)
		if !beforeOK && !afterOK {
			continue
		}
		if beforeOK && afterOK && equal(before, after) {
			continue
		}
		kind := "changed"
		if !beforeOK {
			kind = "added"
		}
		if !afterOK {
			kind = "removed"
		}
		changes = append(changes, Change{Kind: kind, Path: id, Method: "component", Fields: map[string][2]any{"value": {before, after}}})
	}

	sort.Slice(changes, func(left, right int) bool {
		if changes[left].Path != changes[right].Path {
			return changes[left].Path < changes[right].Path
		}
		return changes[left].Method < changes[right].Method
	})
	return changes, nil
}

// Render formats changes as deterministic human-readable lines.
func Render(changes []Change) string {
	if len(changes) == 0 {
		return "OpenAPI documents are semantically equal.\n"
	}
	var output strings.Builder
	for _, change := range changes {
		output.WriteString(change.Kind)
		output.WriteByte(' ')
		output.WriteString(change.Method)
		output.WriteByte(' ')
		output.WriteString(change.Path)
		if len(change.Fields) > 0 {
			encoded, err := json.Marshal(change.Fields)
			if err == nil {
				output.WriteByte(' ')
				output.Write(encoded)
			} else {
				output.WriteString(" {\"fieldsError\":")
				output.WriteString(strconv.Quote(err.Error()))
				output.WriteByte('}')
			}
		}
		output.WriteByte('\n')
	}
	return output.String()
}

func writeError(writer io.Writer, err error) {
	if _, writeErr := io.WriteString(writer, err.Error()+"\n"); writeErr != nil {
		return
	}
}

// Run executes the openapidiff command and returns its documented exit code.
func Run(args []string, stdout, stderr io.Writer) int {
	if stdout == nil || stderr == nil {
		return 2
	}
	flags := flag.NewFlagSet("openapidiff", flag.ContinueOnError)
	flags.SetOutput(stderr)
	jsonOutput := flags.Bool("json", false, "JSON output")
	strict := flags.Bool("strict", false, "reject empty Responses Objects")
	prefix := flags.String("path-prefix", "", "path prefix")
	method := flags.String("method", "", "HTTP method")
	if err := flags.Parse(args); err != nil || flags.NArg() != 2 || (*method != "" && !IsHTTPMethod(*method)) {
		return 2
	}
	loadDocument := Load
	if *strict {
		loadDocument = LoadStrict
	}
	base, err := loadDocument(flags.Arg(0))
	if err != nil {
		writeError(stderr, err)
		return 2
	}
	candidate, err := loadDocument(flags.Arg(1))
	if err != nil {
		writeError(stderr, err)
		return 2
	}
	changes, err := Diff(base, candidate, *prefix, strings.ToLower(*method))
	if err != nil {
		writeError(stderr, err)
		return 2
	}
	if *jsonOutput {
		if err := json.NewEncoder(stdout).Encode(changes); err != nil {
			writeError(stderr, err)
			return 2
		}
	} else if _, err := io.WriteString(stdout, Render(changes)); err != nil {
		writeError(stderr, err)
		return 2
	}
	if len(changes) > 0 {
		return 1
	}
	return 0
}

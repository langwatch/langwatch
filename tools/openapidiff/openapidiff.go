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
	if err := validatePaths(document); err != nil {
		return err
	}
	if err := validateTopLevel(document); err != nil {
		return err
	}
	if strict {
		return validateNonEmptyResponses(document)
	}
	return nil
}

func validatePaths(document map[string]any) error {
	pathsValue, ok := document["paths"]
	if !ok {
		return errors.New("paths is required")
	}
	paths, err := obj(pathsValue)
	if err != nil {
		return fmt.Errorf("paths: %w", err)
	}
	for path, value := range paths {
		if err := validatePathEntry(path, value); err != nil {
			return err
		}
	}
	return nil
}

func validatePathEntry(path string, value any) error {
	if !strings.HasPrefix(path, "/") {
		return fmt.Errorf("paths.%s: path must start with /", path)
	}
	item, err := obj(value)
	if err != nil {
		return fmt.Errorf("path %s: %w", path, err)
	}
	return validatePathItem(path, item)
}

// validateTopLevel checks components, local references, security and servers, in that order.
func validateTopLevel(document map[string]any) error {
	if err := validateOptionalField(document, "components", validateComponents); err != nil {
		return err
	}
	if err := validateLocalReferences(document, document); err != nil {
		return err
	}
	validateRootSecurity := func(value any) error { return validateSecurity(value, "security") }
	if err := validateOptionalField(document, "security", validateRootSecurity); err != nil {
		return err
	}
	validateRootServers := func(value any) error { return validateServers(value, "servers") }
	return validateOptionalField(document, "servers", validateRootServers)
}

func validateOptionalField(document map[string]any, key string, validate func(any) error) error {
	value, ok := document[key]
	if !ok {
		return nil
	}
	return validate(value)
}

// walkJSON calls visit for every object member, depth first, before descending
// into the member's value. location names the object holding the member.
func walkJSON(value any, location string, visit func(key string, child any, location string) error) error {
	switch value := value.(type) {
	case map[string]any:
		return walkJSONObject(value, location, visit)
	case []any:
		return walkJSONArray(value, location, visit)
	}
	return nil
}

func walkJSONObject(object map[string]any, location string, visit func(key string, child any, location string) error) error {
	for key, child := range object {
		if err := visit(key, child, location); err != nil {
			return err
		}
		if err := walkJSON(child, location+"."+key, visit); err != nil {
			return err
		}
	}
	return nil
}

func walkJSONArray(items []any, location string, visit func(key string, child any, location string) error) error {
	for index, child := range items {
		if err := walkJSON(child, location+"["+strconv.Itoa(index)+"]", visit); err != nil {
			return err
		}
	}
	return nil
}

func validateNonEmptyResponses(document map[string]any) error {
	return walkJSON(document, "document", func(key string, child any, location string) error {
		if key != "responses" {
			return nil
		}
		if responses, ok := child.(map[string]any); ok && len(responses) == 0 {
			return fmt.Errorf("%s.responses: must not be empty in strict mode", location)
		}
		return nil
	})
}

func validOpenAPIVersion(version string) bool {
	parts := strings.Split(version, ".")
	if len(parts) != 3 || parts[0] != "3" {
		return false
	}
	for _, part := range parts[1:] {
		if part == "" || !isDigits(part) {
			return false
		}
	}
	return true
}

func isDigits(value string) bool {
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func validatePathItem(path string, item map[string]any) error {
	for key, value := range item {
		if err := validatePathItemField(path, key, value); err != nil {
			return err
		}
	}
	return nil
}

func validatePathItemField(path, key string, value any) error {
	if strings.HasPrefix(key, "x-") {
		return nil
	}
	switch key {
	case "$ref", "summary", "description":
		if _, ok := value.(string); !ok {
			return fmt.Errorf("path %s: %s must be a string", path, key)
		}
		return nil
	case "servers":
		return validateServers(value, "path "+path+" servers")
	case "parameters":
		return validateParameters(value, "path "+path+" parameters")
	default:
		return validatePathOperation(path, key, value)
	}
}

func validatePathOperation(path, method string, value any) error {
	if !IsHTTPMethod(method) || method != strings.ToLower(method) {
		return fmt.Errorf("path %s: unknown path-item field %q", path, method)
	}
	operation, err := obj(value)
	if err != nil {
		return fmt.Errorf("operation %s %s: %w", method, path, err)
	}
	return validateOperation(path, method, operation)
}

func validateLocalReferences(value any, document map[string]any) error {
	return walkJSON(value, "document", func(key string, child any, location string) error {
		if key != "$ref" {
			return nil
		}
		return validateLocalReference(document, child, location)
	})
}

func validateLocalReference(document map[string]any, value any, location string) error {
	reference, ok := value.(string)
	if !ok {
		return fmt.Errorf("%s.$ref must be a string", location)
	}
	if !strings.HasPrefix(reference, "#/components/") {
		return nil
	}
	id, ok := componentID(reference)
	if !ok {
		return fmt.Errorf("%s.$ref is not a supported component reference", location)
	}
	if _, ok := componentValue(document, id); !ok {
		return fmt.Errorf("%s.$ref target %s does not exist", location, id)
	}
	return nil
}

// operationFieldValidators check the operation fields whose validator takes
// the field's label, "operation <method> <path> <field>".
var operationFieldValidators = map[string]func(any, string) error{
	"tags":         validateStringArray,
	"parameters":   validateParameters,
	"requestBody":  validateObjectWithContent,
	"security":     validateSecurity,
	"servers":      validateServers,
	"callbacks":    validateObjectMap,
	"externalDocs": validateObjectOrRef,
}

func validateOperation(path, method string, operation map[string]any) error {
	responses, ok := operation["responses"]
	if !ok {
		return fmt.Errorf("operation %s %s: responses is required", method, path)
	}
	label := "operation " + method + " " + path
	if err := validateResponses(responses, label+" responses"); err != nil {
		return err
	}
	for key, value := range operation {
		if err := validateOperationField(label, key, value); err != nil {
			return err
		}
	}
	return nil
}

func validateOperationField(label, key string, value any) error {
	if strings.HasPrefix(key, "x-") {
		return nil
	}
	if validate, ok := operationFieldValidators[key]; ok {
		return validate(value, label+" "+key)
	}
	switch key {
	case "operationId", "summary", "description":
		if _, ok := value.(string); !ok {
			return fmt.Errorf("%s: %s must be a string", label, key)
		}
	case "deprecated":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("%s: deprecated must be boolean", label)
		}
	case "responses":
		// Validated by validateOperation.
	default:
		return fmt.Errorf("%s: unknown operation field %q", label, key)
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
		return validateReferenceString(reference, label)
	}
	return nil
}

func validateReferenceString(reference any, label string) error {
	if _, ok := reference.(string); !ok {
		return fmt.Errorf("%s.$ref must be a string", label)
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
		if err := validateParameter(item, label+"["+strconv.Itoa(index)+"]", seen); err != nil {
			return err
		}
	}
	return nil
}

func validateParameter(item any, label string, seen map[string]bool) error {
	object, err := obj(item)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	if reference, ok := object["$ref"]; ok {
		return validateReferenceString(reference, label)
	}
	name, nameOK := object["name"].(string)
	location, locationOK := object["in"].(string)
	if !nameOK || name == "" || !locationOK || location == "" {
		return fmt.Errorf("%s: parameter requires name and in", label)
	}
	key := location + "\x00" + name
	if seen[key] {
		return fmt.Errorf("%s: duplicate parameter %s in %s", label, name, location)
	}
	seen[key] = true
	if required, _ := object["required"].(bool); location == "path" && !required {
		return fmt.Errorf("%s: path parameter must be required", label)
	}
	return validateSchemaMember(object, label)
}

func validateResponses(value any, label string) error {
	responses, err := obj(value)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	for key, response := range responses {
		if err := validateObjectWithContent(response, label+"."+key); err != nil {
			return err
		}
	}
	return nil
}

// validateObjectWithContent checks a response or request body: an object or
// reference whose optional content map holds media types.
func validateObjectWithContent(value any, label string) error {
	if err := validateObjectOrRef(value, label); err != nil {
		return err
	}
	return validateContentMember(value, label)
}

func validateContentMember(value any, label string) error {
	object, _ := obj(value)
	content, ok := object["content"]
	if !ok {
		return nil
	}
	return validateContent(content, label+".content")
}

func validateSchemaMember(value any, label string) error {
	object, _ := obj(value)
	schema, ok := object["schema"]
	if !ok {
		return nil
	}
	return validateSchemaOrRef(schema, label+".schema")
}

func validateContent(value any, label string) error {
	content, err := obj(value)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	for mediaType, mediaValue := range content {
		if _, err := obj(mediaValue); err != nil {
			return fmt.Errorf("%s.%s: %w", label, mediaType, err)
		}
		if err := validateSchemaMember(mediaValue, label+"."+mediaType); err != nil {
			return err
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
		if err := validateComponentKind(kind, entries); err != nil {
			return err
		}
	}
	return nil
}

func validateComponentKind(kind string, entries any) error {
	if strings.HasPrefix(kind, "x-") {
		return nil
	}
	if !componentKinds[kind] {
		return fmt.Errorf("components: unknown component kind %q", kind)
	}
	if entries == nil {
		return nil
	}
	if emptyEntries, ok := entries.(map[string]any); ok && emptyEntries == nil {
		return nil
	}
	entryMap, err := obj(entries)
	if err != nil {
		return fmt.Errorf("components.%s: %w", kind, err)
	}
	for name, entry := range entryMap {
		if err := validateComponent(kind, "components."+kind+"."+name, entry); err != nil {
			return err
		}
	}
	return nil
}

// componentMemberValidators check a component's own members once the entry is
// known to be an object or reference.
var componentMemberValidators = map[string]func(any, string) error{
	"responses":     validateContentMember,
	"requestBodies": validateContentMember,
	"headers":       validateSchemaMember,
	"parameters":    validateSchemaMember,
}

func validateComponent(kind, label string, entry any) error {
	switch kind {
	case "pathItems":
		pathItem, err := obj(entry)
		if err != nil {
			return fmt.Errorf("%s: %w", label, err)
		}
		return validatePathItem(label, pathItem)
	case "schemas":
		return validateSchemaOrRef(entry, label)
	}
	if err := validateObjectOrRef(entry, label); err != nil {
		return err
	}
	if validateMembers, ok := componentMemberValidators[kind]; ok {
		return validateMembers(entry, label)
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

// parameterMerge applies path-item parameters, then operation parameters; a
// later parameter with the same identity replaces the earlier one in place.
type parameterMerge struct {
	document map[string]any
	result   []any
	seen     map[string]bool
}

func (merge *parameterMerge) add(value any) {
	items, _ := value.([]any)
	for _, item := range items {
		merge.addOne(item)
	}
}

func (merge *parameterMerge) addOne(item any) {
	key := parameterIdentity(merge.document, item)
	if key == "" {
		merge.result = append(merge.result, item)
		return
	}
	if merge.seen[key] {
		merge.replace(key, item)
		return
	}
	merge.seen[key] = true
	merge.result = append(merge.result, item)
}

func (merge *parameterMerge) replace(key string, item any) {
	for index := range merge.result {
		prior, _ := merge.result[index].(map[string]any)
		if key == parameterIdentity(merge.document, prior) {
			merge.result[index] = item
			return
		}
	}
}

func effectiveParameters(document, pathItem, operation map[string]any) any {
	merge := parameterMerge{document: document, result: make([]any, 0), seen: map[string]bool{}}
	merge.add(pathItem["parameters"])
	merge.add(operation["parameters"])
	return merge.result
}

// firstValue returns key from the first level that has it, innermost first.
func firstValue(levels []map[string]any, key string) (any, bool) {
	for _, level := range levels {
		if value, ok := level[key]; ok {
			return value, true
		}
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
	levels := []map[string]any{operation, pathItem, root}
	if security, ok := firstValue(levels, "security"); ok {
		result["security"] = security
	}
	if servers, ok := firstValue(levels, "servers"); ok {
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
	if len(parts) != 2 {
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
				addReference(child, references)
			}
			collectReferences(child, references)
		}
	case []any:
		for _, child := range value {
			collectReferences(child, references)
		}
	}
}

func addReference(value any, references map[string]bool) {
	reference, ok := value.(string)
	if !ok {
		return
	}
	if id, ok := componentID(reference); ok {
		references[id] = true
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
	resolvedTarget, err := resolvePathItemTarget(document, reference, seen)
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

func resolvePathItemTarget(document map[string]any, reference string, seen map[string]bool) (map[string]any, error) {
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
	return resolvePathItemSeen(document, targetItem, seen)
}

func reachableComponents(base, candidate map[string]any, roots map[string]bool) []string {
	seen := make(map[string]bool, len(roots))
	for root := range roots {
		seen[root] = true
	}
	documents := []map[string]any{base, candidate}
	for changed := true; changed; {
		changed = false
		for id := range seen {
			if expandReferences(seen, id, documents) {
				changed = true
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

// expandReferences adds what component id references in each document to
// seen, and reports whether seen grew.
func expandReferences(seen map[string]bool, id string, documents []map[string]any) bool {
	grew := false
	for _, document := range documents {
		value, ok := componentValue(document, id)
		if !ok {
			continue
		}
		before := len(seen)
		collectReferences(value, seen)
		grew = grew || len(seen) != before
	}
	return grew
}

func pathMatchesPrefix(path, prefix string) bool {
	return prefix == "" || path == prefix || strings.HasPrefix(path, prefix+"/")
}

func snapshotSecurity(value any) any {
	snapshot, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return snapshot["security"]
}

// Scope narrows Diff to the paths under Prefix and to one HTTP Method; the
// zero Scope compares every path and method.
type Scope struct {
	Prefix string
	Method string
}

var httpMethods = []string{"get", "put", "post", "delete", "options", "head", "patch", "trace"}

// differ holds one Diff run: the two documents (base, then candidate), the
// method filter, the component roots reached so far and the changes found.
type differ struct {
	documents [2]map[string]any
	method    string
	roots     map[string]bool
	changes   []Change
}

// pathSide is one document's view of a path: the item as written, the item
// with its $ref resolved, and whether the document has the path at all.
type pathSide struct {
	raw, resolved map[string]any
	present       bool
}

// operationPair is one method on one path in both documents.
type operationPair struct {
	path, method string
	items        [2]map[string]any
	operations   [2]map[string]any
	present      [2]bool
}

// Diff compares selected operations and the components reachable from them.
func Diff(base, candidate map[string]any, scope Scope) ([]Change, error) {
	method := strings.ToLower(scope.Method)
	if method != "" && !IsHTTPMethod(method) {
		return nil, fmt.Errorf("invalid HTTP method %q", method)
	}
	basePaths, err := documentPaths(base, "base")
	if err != nil {
		return nil, err
	}
	candidatePaths, err := documentPaths(candidate, "candidate")
	if err != nil {
		return nil, err
	}
	run := &differ{documents: [2]map[string]any{base, candidate}, method: method, roots: make(map[string]bool), changes: make([]Change, 0)}
	for _, path := range mapKeys(basePaths, candidatePaths) {
		if !pathMatchesPrefix(path, scope.Prefix) {
			continue
		}
		if err := run.diffPath(path, [2]map[string]any{basePaths, candidatePaths}); err != nil {
			return nil, err
		}
	}
	run.diffComponents()
	sortChanges(run.changes)
	return run.changes, nil
}

func documentPaths(document map[string]any, label string) (map[string]any, error) {
	if err := validateDocument(document, false); err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}
	paths, err := obj(document["paths"])
	if err != nil {
		return nil, fmt.Errorf("%s paths: %w", label, err)
	}
	return paths, nil
}

func sortChanges(changes []Change) {
	sort.Slice(changes, func(left, right int) bool {
		if changes[left].Path != changes[right].Path {
			return changes[left].Path < changes[right].Path
		}
		return changes[left].Method < changes[right].Method
	})
}

func (run *differ) diffPath(path string, paths [2]map[string]any) error {
	base, err := run.loadSide(run.documents[0], paths[0], path)
	if err != nil {
		return err
	}
	candidate, err := run.loadSide(run.documents[1], paths[1], path)
	if err != nil {
		return err
	}
	run.diffPathItem(path, base, candidate)
	for _, method := range run.methods() {
		if err := run.diffOperation(path, method, [2]map[string]any{base.resolved, candidate.resolved}); err != nil {
			return err
		}
	}
	return nil
}

func (run *differ) loadSide(document, paths map[string]any, path string) (pathSide, error) {
	value, present := paths[path]
	if !present {
		return pathSide{}, nil
	}
	raw, err := obj(value)
	if err != nil {
		return pathSide{}, fmt.Errorf("path %s: %w", path, err)
	}
	resolved, err := resolvePathItem(document, raw)
	if err != nil {
		return pathSide{}, fmt.Errorf("path %s: %w", path, err)
	}
	if run.method == "" || hasOperation(resolved, run.method) {
		collectReferences(metadata(raw), run.roots)
		collectReferences(metadata(resolved), run.roots)
	}
	return pathSide{raw: raw, resolved: resolved, present: true}, nil
}

// diffPathItem reports a changed path-item metadata block when no method filter applies.
func (run *differ) diffPathItem(path string, base, candidate pathSide) {
	if run.method != "" || !base.present || !candidate.present {
		return
	}
	fields := operationFields(effectiveMetadata(base.raw, base.resolved), effectiveMetadata(candidate.raw, candidate.resolved))
	if len(fields) > 0 {
		run.changes = append(run.changes, Change{Kind: "changed", Path: path, Method: "<path-item>", Fields: fields})
	}
}

func (run *differ) methods() []string {
	if run.method != "" {
		return []string{run.method}
	}
	return httpMethods
}

func (run *differ) diffOperation(path, method string, items [2]map[string]any) error {
	pair := operationPair{path: path, method: method, items: items}
	for side, item := range items {
		value, present := item[method]
		if !present {
			continue
		}
		operation, err := obj(value)
		if err != nil {
			return fmt.Errorf("operation %s %s: %w", method, path, err)
		}
		collectReferences(operation, run.roots)
		pair.operations[side], pair.present[side] = operation, true
	}
	switch {
	case pair.present[0] && pair.present[1]:
		run.changedOperation(pair)
	case pair.present[0] || pair.present[1]:
		run.addedOrRemovedOperation(pair)
	}
	return nil
}

func (run *differ) snapshot(pair operationPair, side int) map[string]any {
	return operationSnapshot(run.documents[side], pair.items[side], pair.operations[side])
}

func (run *differ) changedOperation(pair operationPair) {
	before, after := run.snapshot(pair, 0), run.snapshot(pair, 1)
	collectSecurityReferences(before["security"], run.roots)
	collectSecurityReferences(after["security"], run.roots)
	fields := operationFields(before, after)
	if len(fields) > 0 {
		run.changes = append(run.changes, Change{Kind: "changed", Path: pair.path, Method: pair.method, Fields: fields})
	}
}

func (run *differ) addedOrRemovedOperation(pair operationPair) {
	kind := "removed"
	before, after := any(nil), any(nil)
	if pair.present[0] {
		before = run.snapshot(pair, 0)
	} else {
		kind = "added"
	}
	if pair.present[1] {
		after = run.snapshot(pair, 1)
	}
	collectSecurityReferences(snapshotSecurity(before), run.roots)
	collectSecurityReferences(snapshotSecurity(after), run.roots)
	run.changes = append(run.changes, Change{Kind: kind, Path: pair.path, Method: pair.method, Fields: map[string][2]any{"operation": {before, after}}})
}

func (run *differ) diffComponents() {
	for _, id := range reachableComponents(run.documents[0], run.documents[1], run.roots) {
		if change, ok := componentChange(run.documents, id); ok {
			run.changes = append(run.changes, change)
		}
	}
}

func componentChange(documents [2]map[string]any, id string) (Change, bool) {
	before, beforeOK := componentValue(documents[0], id)
	after, afterOK := componentValue(documents[1], id)
	if !beforeOK && !afterOK {
		return Change{}, false
	}
	if beforeOK && afterOK && equal(before, after) {
		return Change{}, false
	}
	kind := "changed"
	if !beforeOK {
		kind = "added"
	}
	if !afterOK {
		kind = "removed"
	}
	return Change{Kind: kind, Path: id, Method: "component", Fields: map[string][2]any{"value": {before, after}}}, true
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

// invocation is one parsed command line: how to load each document, the two
// files and the scope to compare.
type invocation struct {
	load                    func(string) (map[string]any, error)
	basePath, candidatePath string
	scope                   Scope
}

func (command invocation) changes() ([]Change, error) {
	base, err := command.load(command.basePath)
	if err != nil {
		return nil, err
	}
	candidate, err := command.load(command.candidatePath)
	if err != nil {
		return nil, err
	}
	return Diff(base, candidate, command.scope)
}

func writeChanges(stdout io.Writer, changes []Change, jsonOutput bool) error {
	if jsonOutput {
		return json.NewEncoder(stdout).Encode(changes)
	}
	_, err := io.WriteString(stdout, Render(changes))
	return err
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
	command := invocation{load: Load, basePath: flags.Arg(0), candidatePath: flags.Arg(1), scope: Scope{Prefix: *prefix, Method: *method}}
	if *strict {
		command.load = LoadStrict
	}
	changes, err := command.changes()
	if err != nil {
		writeError(stderr, err)
		return 2
	}
	if err := writeChanges(stdout, changes, *jsonOutput); err != nil {
		writeError(stderr, err)
		return 2
	}
	if len(changes) > 0 {
		return 1
	}
	return 0
}

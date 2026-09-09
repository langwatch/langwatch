package apidiff

import (
	"fmt"
	"regexp"
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

// SymbolTable holds IDs captured from earlier responses this run, bucketed
// by the parameter name each ID can satisfy. There is deliberately no
// untyped catch-all: an operation whose {promptId} has no captured prompt id
// is skipped rather than probed with a trace id.
type SymbolTable struct {
	byParam map[string][]string
}

// NewSymbolTable returns an empty table.
func NewSymbolTable() *SymbolTable {
	return &SymbolTable{byParam: map[string][]string{}}
}

// Capture walks a decoded response body in sorted-key order (deterministic:
// capture order feeds resolution) and records string values under id-like
// keys. Each ID is filed under the normalized form of its own key
// (promptId → promptid) and, when the key is a bare "id", under the resource
// the producing operation's path names (POST /api/prompts → promptid).
// Returns the captured IDs.
func (table *SymbolTable) Capture(operationPath string, body any) []string {
	captured := make([]string, 0)
	table.captureValue(resourceParamName(operationPath, ""), body, &captured)
	return captured
}

func (table *SymbolTable) captureValue(resourceParam string, value any, captured *[]string) {
	switch typed := value.(type) {
	case map[string]any:
		table.captureObject(resourceParam, typed, captured)
	case []any:
		for _, element := range typed {
			table.captureValue(resourceParam, element, captured)
		}
	}
}

func (table *SymbolTable) captureObject(resourceParam string, object map[string]any, captured *[]string) {
	for _, key := range sortedKeys(object) {
		child := object[key]
		if text, ok := child.(string); ok && isIDKey(key) && text != "" {
			table.file(normalizeParamName(key), text)
			if bareIDKey(key) && resourceParam != "" {
				table.file(resourceParam, text)
			}
			*captured = append(*captured, text)
		}
		table.captureValue(resourceParam, child, captured)
	}
}

func (table *SymbolTable) file(bucket, id string) {
	if bucket == "" {
		return
	}
	table.byParam[bucket] = append(table.byParam[bucket], id)
}

// Lookup returns the most recently captured ID that can satisfy the named
// parameter of an operation at operationPath. A bare {id}/{idOrSlug}/{slug}
// resolves through the resource its own path names, never through whatever
// was captured last.
func (table *SymbolTable) Lookup(paramName, operationPath string) (string, bool) {
	for _, bucket := range lookupBuckets(paramName, operationPath) {
		if values := table.byParam[bucket]; len(values) > 0 {
			return values[len(values)-1], true
		}
	}
	return "", false
}

// lookupBuckets names the buckets a parameter may resolve from, in order.
func lookupBuckets(paramName, operationPath string) []string {
	normalized := normalizeParamName(paramName)
	if !bareIDKey(paramName) {
		return []string{normalized}
	}
	if resource := resourceParamName(operationPath, paramName); resource != "" {
		return []string{resource}
	}
	return nil
}

// bareIDKey reports whether a key or parameter name carries no resource of
// its own ("id", "idOrSlug", "slugOrId", "slug") and must be typed by its
// path. idOrSlug and slugOrId are the same shape written both ways across
// the REST surface - dataset routes use the latter.
func bareIDKey(name string) bool {
	switch normalizeParamName(name) {
	case "id", "idorslug", "slugorid", "slug", "_id":
		return true
	}
	return false
}

// versionSegmentPattern matches a dated-address snapshot segment
// (YYYY-MM-DD). Every REST family that carries dated addressing serves the
// same resource at three equivalent paths - bare, "latest", and the dated
// snapshot - so none of the three may change which resource a bare id names.
var versionSegmentPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func isVersionSegment(segment string) bool {
	return segment == "latest" || versionSegmentPattern.MatchString(segment)
}

// resourceParamName derives the parameter bucket a path parameter's own
// resource implies: the nearest literal segment before that parameter's own
// placeholder in the path (skipping dated-address segments), singularized.
// Position matters, not just "the path's last literal segment" - a bare id
// can be followed by more path, not just precede it:
// /api/agents/{id}/call names "agentid" for {id}, not "callid", and
// /api/prompts/{id}/versions/{versionId}/restore names "promptid" for {id}
// and "versionid" for {versionId}.
//
// paramName "" (Capture's use, filing a just-created resource's own id) has
// no placeholder to anchor on, so the scan starts at the path's end instead
// - /api/prompts/{id}/versions names "versionid" there, the collection the
// response belongs to, not the {id} already in the path.
func resourceParamName(operationPath, paramName string) string {
	segments := strings.Split(strings.Trim(operationPath, "/"), "/")
	start := len(segments) - 1
	if paramName != "" {
		if position := placeholderIndex(segments, paramName); position >= 0 {
			start = position - 1
		}
	}
	for index := start; index >= 0; index-- {
		segment := segments[index]
		if segment == "" || strings.HasPrefix(segment, "{") || isVersionSegment(segment) {
			continue
		}
		return normalizeParamName(singularize(segment)) + "id"
	}
	return ""
}

// placeholderIndex returns the index of a parameter's own {name} segment in
// a split path, or -1 when the path never names it.
func placeholderIndex(segments []string, paramName string) int {
	placeholder := "{" + paramName + "}"
	for index, segment := range segments {
		if segment == placeholder {
			return index
		}
	}
	return -1
}

// singularize trims a trailing plural "s" (prompts → prompt), leaving words
// that do not end in one untouched.
func singularize(word string) string {
	if len(word) > 2 && strings.HasSuffix(word, "s") && !strings.HasSuffix(word, "ss") {
		return strings.TrimSuffix(word, "s")
	}
	return word
}

// isIDKey matches the identifier subset of the volatile key patterns.
func isIDKey(key string) bool {
	return key == "id" || strings.HasSuffix(key, "_id") || strings.HasSuffix(key, "Id")
}

// SeededConstants maps normalized parameter names to the fixed identities
// the deterministic seed creates (packages/prisma-client/prisma/seed.ts), and
// to a handful of literal values the CLIENT picks rather than the server  - 
// a slug the caller names, not an id the server assigns, so there is nothing
// to mint or capture. Both sides get the same literal, so the request is
// still identical between A and B; the response may legitimately 404 when
// the named resource does not exist, and that is itself a comparable probe
// rather than a skip.
var SeededConstants = map[string]string{
	"projectid":      "local-dev-project",
	"project":        "local-dev-project",
	"organizationid": "local-dev-organization",
	"organisationid": "local-dev-organization",
	"orgid":          "local-dev-organization",
	"organization":   "local-dev-organization",
	"teamid":         "local-dev-team",
	"team":           "local-dev-team",
	// Client-chosen slugs (see the comment above): PUT /api/model-providers/{provider}
	// configures a fixed provider catalog entry; PUT/DELETE /api/prompts/tags/{tag}
	// and PUT /api/prompts/{id}/tags/{tag} name a caller-chosen tag; PUT/GET/DELETE
	// /api/agent-cache/{name} names a caller-chosen cache entry; the "repository"
	// query param on GET /api/coding-agent/pull-request-usage names an owner/repo
	// slug; the "from" query param on GET /api/webhooks/v1/events is a cursor
	// timestamp, reusing the same fixed instant every synthesized payload uses.
	"provider":   "openai",
	"tag":        "apidiff-tag",
	"name":       "apidiff-agent-cache-entry",
	"repository": "apidiff/apidiff",
	"from":       synthDateTime,
}

// ResolveParam picks a value for a path or required query parameter: spec
// examples/defaults first, then seeded constants matched by name, then the
// symbol table, typed by the parameter name and the operation's own path.
//
// A bare {id} is deliberately NOT also resolved against the seeded
// project/organization/team constants by matching its own path's resource
// (e.g. /api/projects/{id}) the way a literally-named {projectId} is: one
// matching path in this union is POST /api/projects/{id}/regenerate-api-key,
// which would rotate the seeded project's own API key away from under every
// later probe still to run on that side. Minting that id is a hazard, not a
// convenience, so it stays unresolved and the operation stays skipped.
func ResolveParam(param Param, symbols *SymbolTable, operationPath string) (string, bool) {
	if param.HasValue {
		return fmt.Sprint(param.Example), true
	}
	if value, ok := SeededConstants[normalizeParamName(param.Name)]; ok {
		return value, true
	}
	return symbols.Lookup(param.Name, operationPath)
}

func normalizeParamName(name string) string {
	name = strings.ToLower(name)
	return strings.ReplaceAll(strings.ReplaceAll(name, "-", ""), "_", "")
}

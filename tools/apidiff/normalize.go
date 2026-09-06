package apidiff

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Volatile-value masking is key-name driven: no schema is needed and both
// sides mask identically. A VALUE under an object key matching any of these
// patterns is replaced by "<masked:kind>" before comparison; keys themselves
// are never masked. The patterns cover identifiers, timestamps, and secrets:
//
//	id, *_id, *Id                        — resource identifiers
//	*_at, *At, timestamp, date, time     — timestamps
//	token, secret, password, api_key, hash — credentials and digests
//	url, uri, path, slug, platformUrl    — per-instance URLs and random slugs
var volatileKeyPatterns = []*regexp.Regexp{
	regexp.MustCompile(`^id$|_id$|Id$`),
	regexp.MustCompile(`_at$|At$`),
	regexp.MustCompile(`(?i)^(timestamp|date|time|token|secret|password|hash|api_?key|apikey)$`),
	regexp.MustCompile(`(?i)(token|secret|password)`),
	regexp.MustCompile(`(?i)^(url|uri|path|slug|platform_?url)$`),
}

// IsVolatileKey reports whether values under key must be masked before
// comparison.
func IsVolatileKey(key string) bool {
	for _, pattern := range volatileKeyPatterns {
		if pattern.MatchString(key) {
			return true
		}
	}
	return false
}

// Scalar kinds used by Shape. Numbers are not split into integer/float: JSON
// decoders on either side may disagree, and the diff is about behavior.
const (
	KindObject  = "object"
	KindArray   = "array"
	KindString  = "string"
	KindNumber  = "number"
	KindBoolean = "boolean"
	KindNull    = "null"
	kindUnion   = "union"
)

// Shape is the reduced shape tree of a JSON document: objects keep their keys
// with child shapes, arrays keep the union of element shapes plus the exact
// length, and scalars keep only their kind.
type Shape struct {
	Kind     string            `json:"kind"`
	Children map[string]*Shape `json:"children,omitempty"`
	Element  *Shape            `json:"element,omitempty"`
	Length   *int              `json:"length,omitempty"`
	members  map[string]bool
}

// ShapeOf reduces a decoded JSON value to its shape tree.
func ShapeOf(value any) *Shape {
	switch typed := value.(type) {
	case map[string]any:
		shape := &Shape{Kind: KindObject, Children: make(map[string]*Shape, len(typed))}
		for key, child := range typed {
			shape.Children[key] = ShapeOf(child)
		}
		return shape
	case []any:
		length := len(typed)
		shape := &Shape{Kind: KindArray, Length: &length}
		for _, element := range typed {
			shape.Element = unionShapes(shape.Element, ShapeOf(element))
		}
		return shape
	case string:
		return &Shape{Kind: KindString}
	case float64, json.Number:
		return &Shape{Kind: KindNumber}
	case bool:
		return &Shape{Kind: KindBoolean}
	case nil:
		return &Shape{Kind: KindNull}
	default:
		return &Shape{Kind: fmt.Sprintf("%T", value)}
	}
}

// unionShapes merges two array element shapes; divergent members produce a
// synthetic union shape holding the canonical member signatures.
func unionShapes(left, right *Shape) *Shape {
	if left == nil {
		return right
	}
	if right == nil || left.Signature() == right.Signature() {
		return left
	}
	members := map[string]bool{}
	for _, shape := range []*Shape{left, right} {
		if shape.Kind == kindUnion {
			for member := range shape.members {
				members[member] = true
			}
			continue
		}
		members[shape.Signature()] = true
	}
	return &Shape{Kind: kindUnion, members: members}
}

// Signature renders the canonical, deterministic form of a shape.
func (shape *Shape) Signature() string {
	var output strings.Builder
	shape.writeSignature(&output)
	return output.String()
}

func (shape *Shape) writeSignature(output *strings.Builder) {
	if shape.Kind == kindUnion {
		shape.writeUnionSignature(output)
		return
	}
	output.WriteString(shape.Kind)
	switch shape.Kind {
	case KindObject:
		shape.writeObjectSignature(output)
	case KindArray:
		shape.writeArraySignature(output)
	}
}

func (shape *Shape) writeUnionSignature(output *strings.Builder) {
	members := make([]string, 0, len(shape.members))
	for member := range shape.members {
		members = append(members, member)
	}
	sort.Strings(members)
	output.WriteString("union(")
	output.WriteString(strings.Join(members, "|"))
	output.WriteString(")")
}

func (shape *Shape) writeObjectSignature(output *strings.Builder) {
	keys := make([]string, 0, len(shape.Children))
	for key := range shape.Children {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	output.WriteString("{")
	for index, key := range keys {
		if index > 0 {
			output.WriteString(",")
		}
		output.WriteString(quoteJSONKey(key))
		output.WriteString(":")
		shape.Children[key].writeSignature(output)
	}
	output.WriteString("}")
}

func (shape *Shape) writeArraySignature(output *strings.Builder) {
	output.WriteString("[")
	if shape.Element != nil {
		shape.Element.writeSignature(output)
	}
	output.WriteString("]")
	if shape.Length != nil {
		fmt.Fprintf(output, "#%d", *shape.Length)
	}
}

func quoteJSONKey(key string) string {
	encoded, err := json.Marshal(key)
	if err != nil {
		return fmt.Sprintf("%q", key)
	}
	return string(encoded)
}

// MaskValue returns value with every value under a volatile object key
// replaced by "<masked:kind>". A masked object or array collapses to a single
// marker, because its contents are per-instance state.
func MaskValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		masked := make(map[string]any, len(typed))
		for key, child := range typed {
			if IsVolatileKey(key) {
				masked[key] = "<masked:" + ShapeOf(child).Kind + ">"
				continue
			}
			masked[key] = MaskValue(child)
		}
		return masked
	case []any:
		masked := make([]any, len(typed))
		for index, element := range typed {
			masked[index] = MaskValue(element)
		}
		return masked
	default:
		return value
	}
}

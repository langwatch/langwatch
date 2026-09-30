package apidiff

import (
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// scenarioPlaceholder is {name}, an identifier only, so a JSON snippet inside
// a string ("{ return null; }") is never mistaken for one.
var scenarioPlaceholder = regexp.MustCompile(`\{([A-Za-z_][A-Za-z0-9_]*)([+-][0-9]+)?\}`)

// scenarioAny in an expected body means "present and not null"; scenarioAbsent
// means the key is not in the body at all.
const (
	scenarioAny    = "<any>"
	scenarioAbsent = "<absent>"
)

func matchesAnyID(id string, patterns []string) bool {
	for _, pattern := range patterns {
		if matched, err := path.Match(pattern, id); err == nil && matched {
			return true
		}
	}
	return false
}

// expandText fills {name} from vars; an unknown name is an error, so a typo
// never goes out to the API as a literal.
func expandText(text string, vars map[string]string) (string, error) {
	var unknown []string
	expanded := scenarioPlaceholder.ReplaceAllStringFunc(text, func(match string) string {
		name := match[1 : len(match)-1]
		value, ok := placeholderValue(name, vars)
		if !ok {
			unknown = append(unknown, name)
		}
		return value
	})
	if len(unknown) > 0 {
		return "", fmt.Errorf("unknown placeholder {%s} in %q", strings.Join(unknown, "}, {"), excerpt(text))
	}
	return expanded, nil
}

// placeholderValue is a variable, or {nowMs} with an optional offset in
// milliseconds ({nowMs-3600000}), read when the text is expanded.
func placeholderValue(name string, vars map[string]string) (string, bool) {
	if value, ok := vars[name]; ok {
		return value, true
	}
	base, offset := name, ""
	if cut := strings.IndexAny(name, "+-"); cut >= 0 {
		base, offset = name[:cut], name[cut:]
	}
	if base != "nowMs" {
		return "", false
	}
	shift, _ := strconv.ParseInt(offset, 10, 64)
	return strconv.FormatInt(time.Now().UnixMilli()+shift, 10), true
}

// expandValue fills placeholders in every string of a decoded YAML value.
func expandValue(value any, vars map[string]string) (any, error) {
	switch typed := value.(type) {
	case string:
		// A value that is exactly {nowMs[±N]} is a number, so a JSON timestamp field gets one.
		if name, ok := strings.CutPrefix(typed, "{nowMs"); ok && strings.HasSuffix(name, "}") && scenarioPlaceholder.FindString(typed) == typed {
			if value, ok := placeholderValue(typed[1:len(typed)-1], vars); ok {
				return strconv.ParseInt(value, 10, 64)
			}
		}
		return expandText(typed, vars)
	case []any:
		out := make([]any, len(typed))
		for index, element := range typed {
			expanded, err := expandValue(element, vars)
			if err != nil {
				return nil, err
			}
			out[index] = expanded
		}
		return out, nil
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, element := range typed {
			expanded, err := expandValue(element, vars)
			if err != nil {
				return nil, err
			}
			out[key] = expanded
		}
		return out, nil
	}
	return value, nil
}

// lookupPath walks a dotted path through decoded JSON: object keys, and
// integers into arrays. The empty path is the value itself.
func lookupPath(value any, dotted string) (any, bool) {
	if dotted == "" {
		return value, true
	}
	current := value
	for _, segment := range strings.Split(dotted, ".") {
		switch typed := current.(type) {
		case map[string]any:
			next, ok := typed[segment]
			if !ok {
				return nil, false
			}
			current = next
		case []any:
			index, err := strconv.Atoi(segment)
			if err != nil || index < 0 || index >= len(typed) {
				return nil, false
			}
			current = typed[index]
		default:
			return nil, false
		}
	}
	return current, true
}

// checkExpect answers "" when the response holds the expectation, else the
// first thing that does not, naming it. The expectation is already expanded.
func checkExpect(expect scenarioExpect, result SideResult) string {
	if len(expect.Status) > 0 && !slices.Contains(expect.Status, result.Status) {
		return fmt.Sprintf("status %d, expected %s: %s", result.Status, joinInts(expect.Status), excerpt(result.Body))
	}
	for _, text := range expect.Contains {
		if !strings.Contains(result.Body, text) {
			return fmt.Sprintf("body does not contain %q", text)
		}
	}
	for _, text := range expect.NotContains {
		if strings.Contains(result.Body, text) {
			return fmt.Sprintf("body contains %q", text)
		}
	}
	if expect.Body == nil && expect.Length == nil {
		return ""
	}
	decoded, ok := decodeJSONBody(result.Body)
	if !ok {
		return "body is not JSON: " + excerpt(result.Body)
	}
	if expect.Body != nil {
		if detail := matchBody(expect.Body, decoded, ""); detail != "" {
			return detail
		}
	}
	return checkLength(expect, decoded)
}

func joinInts(values []int) string {
	texts := make([]string, len(values))
	for index, value := range values {
		texts[index] = strconv.Itoa(value)
	}
	return strings.Join(texts, "|")
}

func checkLength(expect scenarioExpect, decoded any) string {
	if expect.Length == nil {
		return ""
	}
	found, ok := lookupPath(decoded, expect.Path)
	if !ok {
		return fmt.Sprintf("path %q is not in the body", expect.Path)
	}
	length, ok := lengthOf(found)
	if !ok {
		return fmt.Sprintf("path %q holds %s, which has no length", expect.Path, excerptValue(found))
	}
	if length != *expect.Length {
		return fmt.Sprintf("path %q has length %d, expected %d", expect.Path, length, *expect.Length)
	}
	return ""
}

func lengthOf(value any) (int, bool) {
	switch typed := value.(type) {
	case []any:
		return len(typed), true
	case map[string]any:
		return len(typed), true
	case string:
		return len(typed), true
	}
	return 0, false
}

// matchBody is a subset match: every wanted key is in got and matches, a
// dotted key that is not a literal key walks a path, a wanted array matches
// element by element from the start.
func matchBody(want, got any, at string) string {
	switch typed := want.(type) {
	case map[string]any:
		return matchObject(typed, got, at)
	case []any:
		return matchArray(typed, got, at)
	case string:
		if typed == scenarioAny {
			return presentDetail(got, at)
		}
	}
	if scalarEqual(want, got) {
		return ""
	}
	return fmt.Sprintf("%s: expected %s, got %s", pointerOrRoot(at), excerptValue(want), excerptValue(got))
}

func presentDetail(got any, at string) string {
	if got == nil {
		return pointerOrRoot(at) + ": expected a value, got null"
	}
	return ""
}

func matchObject(want map[string]any, got any, at string) string {
	object, ok := got.(map[string]any)
	if !ok {
		return fmt.Sprintf("%s: expected an object, got %s", pointerOrRoot(at), excerptValue(got))
	}
	for _, key := range sortedKeys(want) {
		child, found := object[key]
		if !found {
			child, found = lookupPath(object, key)
		}
		if want[key] == scenarioAbsent {
			if found {
				return fmt.Sprintf("%s/%s: expected it absent, got %s", at, key, excerptValue(child))
			}
			continue
		}
		if !found {
			return at + "/" + key + ": missing from the body"
		}
		if detail := matchBody(want[key], child, at+"/"+key); detail != "" {
			return detail
		}
	}
	return ""
}

func matchArray(want []any, got any, at string) string {
	elements, ok := got.([]any)
	if !ok || len(elements) < len(want) {
		return fmt.Sprintf("%s: expected an array of at least %d, got %s", pointerOrRoot(at), len(want), excerptValue(got))
	}
	for index := range want {
		if detail := matchBody(want[index], elements[index], fmt.Sprintf("%s/%d", at, index)); detail != "" {
			return detail
		}
	}
	return ""
}

// scalarEqual compares a YAML scalar with a decoded JSON one: numbers by
// value, everything else by identity.
func scalarEqual(want, got any) bool {
	if want == nil || got == nil {
		return want == nil && got == nil
	}
	wantNumber, wantIsNumber := numberOf(want)
	gotNumber, gotIsNumber := numberOf(got)
	if wantIsNumber || gotIsNumber {
		return wantIsNumber && gotIsNumber && wantNumber == gotNumber
	}
	return want == got
}

func numberOf(value any) (float64, bool) {
	switch typed := value.(type) {
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case float64:
		return typed, true
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil
	}
	return 0, false
}

// captureText renders a captured value the way a path or query wants it.
func captureText(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	case nil:
		return ""
	case map[string]any, []any:
		encoded, _ := json.Marshal(typed)
		return string(encoded)
	}
	return fmt.Sprint(value)
}

// successDetail is the check a step without an expect gets: any 2xx holds.
func successDetail(result SideResult) string {
	if result.Status >= 200 && result.Status < 300 {
		return ""
	}
	return fmt.Sprintf("status %d, expected 2xx: %s", result.Status, excerpt(result.Body))
}

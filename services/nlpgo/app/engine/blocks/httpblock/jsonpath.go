package httpblock

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// ExtractJSONPath returns the value at the given JSONPath expression
// against the parsed JSON `data`. Single-match expressions return the
// raw value; multi-match expressions (using `[*]`) return a slice of
// the matched values, mirroring jsonpath_ng's len-based behavior.
//
// Supported syntax (a subset of JSONPath, sized for the workflows we
// observe in the Python tests):
//   $                     — root
//   $.foo                 — child key
//   $.foo.bar.baz         — nested keys
//   $.items[0]            — numeric index
//   $.items[*]            — every element
//   $.items[*].id         — every element's "id" key
//
// Anything outside this subset returns an error.
func ExtractJSONPath(data any, path string) (any, error) {
	if path == "" {
		return nil, errors.New("jsonpath: empty expression")
	}
	if !strings.HasPrefix(path, "$") {
		return nil, fmt.Errorf("jsonpath: expression must start with '$', got %q", path)
	}
	if path == "$" {
		return data, nil
	}
	rest := path[1:]
	matches, err := walk([]any{data}, rest)
	if err != nil {
		return nil, err
	}
	if len(matches) == 0 {
		return nil, ErrNoMatch
	}
	if len(matches) == 1 {
		return matches[0], nil
	}
	return matches, nil
}

// ErrNoMatch is returned when the JSONPath matches no element.
var ErrNoMatch = errors.New("jsonpath: no match")

// walk advances each value in `cur` by one path segment (a `.key` or
// `[index]` or `[*]`) and returns the resulting frontier.
func walk(cur []any, path string) ([]any, error) {
	for path != "" {
		var (
			seg     string
			segKind byte // '.', '[', or 0 for root
		)
		switch path[0] {
		case '.':
			path = path[1:]
			// segment ends at next '.' or '['
			end := indexAny(path, ".[")
			if end < 0 {
				seg = path
				path = ""
			} else {
				seg = path[:end]
				path = path[end:]
			}
			segKind = '.'
		case '[':
			end := strings.Index(path, "]")
			if end < 0 {
				return nil, fmt.Errorf("jsonpath: unclosed '['")
			}
			seg = path[1:end]
			path = path[end+1:]
			segKind = '['
		default:
			return nil, fmt.Errorf("jsonpath: unexpected character %q", path[0])
		}

		next := make([]any, 0, len(cur))
		for _, v := range cur {
			switch segKind {
			case '.':
				m, ok := v.(map[string]any)
				if !ok {
					continue
				}
				if val, ok := m[seg]; ok {
					next = append(next, val)
				}
			case '[':
				if seg == "*" {
					arr, ok := v.([]any)
					if !ok {
						continue
					}
					next = append(next, arr...)
					continue
				}
				idx, err := strconv.Atoi(seg)
				if err != nil {
					return nil, fmt.Errorf("jsonpath: invalid index %q", seg)
				}
				arr, ok := v.([]any)
				if !ok {
					continue
				}
				if idx >= 0 && idx < len(arr) {
					next = append(next, arr[idx])
				}
			}
		}
		cur = next
	}
	return cur, nil
}

func indexAny(s, chars string) int {
	for i, c := range s {
		if strings.IndexByte(chars, byte(c)) >= 0 {
			return i
		}
	}
	return -1
}

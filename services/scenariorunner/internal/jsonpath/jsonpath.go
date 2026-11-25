// Package jsonpath evaluates the JSONPath subset an HTTP target's output and
// session paths use, over values decoded by jsjson: `$`, `.name`, `..name`,
// `*`, `['name']`, `[n]`, `[-n]`, unions and slices. Filter and script
// expressions are refused with ErrUnsupported; the Node child's jsonpath-plus
// evaluates them, so a caller treats that refusal as "no match".
package jsonpath

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

// ErrUnsupported is a path using syntax outside the supported subset.
var ErrUnsupported = errors.New("jsonpath: filter and script expressions are not supported")

type selectorKind int

const (
	selName selectorKind = iota
	selWildcard
	selIndex
	selSlice
)

type selector struct {
	kind             selectorKind
	name             string
	index            int
	start, end, step *int
}

type segment struct {
	recursive bool
	selectors []selector
}

// Query returns every value the path selects in data, in document order.
func Query(path string, data any) ([]any, error) {
	segs, err := parse(path)
	if err != nil {
		return nil, err
	}
	nodes := []any{data}
	for _, seg := range segs {
		nodes = step(seg, nodes)
	}
	return nodes, nil
}

func step(seg segment, nodes []any) []any {
	var next []any
	for _, n := range nodes {
		if !seg.recursive {
			next = append(next, apply(seg.selectors, n)...)
			continue
		}
		for _, d := range descendants(n) {
			next = append(next, apply(seg.selectors, d)...)
		}
	}
	return next
}

func descendants(v any) []any {
	out := []any{v}
	switch t := v.(type) {
	case *jsjson.Object:
		for _, k := range t.Keys() {
			c, _ := t.Get(k)
			out = append(out, descendants(c)...)
		}
	case []any:
		for _, c := range t {
			out = append(out, descendants(c)...)
		}
	}
	return out
}

func apply(sels []selector, v any) []any {
	var out []any
	for _, s := range sels {
		switch s.kind {
		case selName:
			out = append(out, selectName(s.name, v)...)
		case selWildcard:
			out = append(out, children(v)...)
		case selIndex:
			out = append(out, selectIndex(s.index, v)...)
		case selSlice:
			if arr, ok := v.([]any); ok {
				out = append(out, slice(arr, s)...)
			}
		}
	}
	return out
}

func selectName(name string, v any) []any {
	switch t := v.(type) {
	case *jsjson.Object:
		if c, ok := t.Get(name); ok {
			return []any{c}
		}
	case []any:
		if i, err := strconv.Atoi(name); err == nil && i >= 0 && i < len(t) {
			return []any{t[i]}
		}
	}
	return nil
}

func children(v any) []any {
	switch t := v.(type) {
	case *jsjson.Object:
		out := make([]any, 0, t.Len())
		for _, k := range t.Keys() {
			c, _ := t.Get(k)
			out = append(out, c)
		}
		return out
	case []any:
		return t
	}
	return nil
}

func selectIndex(i int, v any) []any {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	if i < 0 {
		i += len(arr)
	}
	if i >= 0 && i < len(arr) {
		return []any{arr[i]}
	}
	return nil
}

func slice(arr []any, s selector) []any {
	n := len(arr)
	step := 1
	if s.step != nil {
		step = *s.step
	}
	if step <= 0 {
		return nil
	}
	norm := func(p *int, def int) int {
		if p == nil {
			return def
		}
		i := *p
		if i < 0 {
			i += n
		}
		return max(0, min(i, n))
	}
	start, end := norm(s.start, 0), norm(s.end, n)
	var out []any
	for i := start; i < end; i += step {
		out = append(out, arr[i])
	}
	return out
}

func parse(path string) ([]segment, error) {
	p := strings.TrimSpace(path)
	if p == "" {
		return nil, errors.New("jsonpath: empty path")
	}
	if strings.HasPrefix(p, "$") {
		p = p[1:]
	} else if !strings.HasPrefix(p, ".") && !strings.HasPrefix(p, "[") {
		p = "." + p
	}
	var segs []segment
	for len(p) > 0 {
		seg, rest, err := parseSegment(p, path)
		if err != nil {
			return nil, err
		}
		segs = append(segs, seg)
		p = rest
	}
	return segs, nil
}

// parseSegment reads one `..x`, `.x` or `[...]` off the front of p.
func parseSegment(p, path string) (segment, string, error) {
	recursive := strings.HasPrefix(p, "..")
	switch {
	case recursive:
		p = p[2:]
	case strings.HasPrefix(p, "."):
		p = p[1:]
	case strings.HasPrefix(p, "["):
		sels, rest, err := parseBracket(p)
		return segment{selectors: sels}, rest, err
	default:
		return segment{}, "", fmt.Errorf("jsonpath: unexpected %q in %q", p[:1], path)
	}
	if recursive && strings.HasPrefix(p, "[") {
		sels, rest, err := parseBracket(p)
		return segment{recursive: true, selectors: sels}, rest, err
	}
	name, rest := readName(p)
	if name == "" {
		return segment{}, "", fmt.Errorf("jsonpath: expected a name in %q", path)
	}
	return segment{recursive: recursive, selectors: []selector{nameOrWildcard(name)}}, rest, nil
}

func nameOrWildcard(name string) selector {
	if name == "*" {
		return selector{kind: selWildcard}
	}
	return selector{kind: selName, name: name}
}

func readName(p string) (string, string) {
	i := 0
	for i < len(p) && p[i] != '.' && p[i] != '[' {
		i++
	}
	return p[:i], p[i:]
}

func parseBracket(p string) ([]selector, string, error) {
	end, err := closingBracket(p)
	if err != nil {
		return nil, "", err
	}
	inner := strings.TrimSpace(p[1:end])
	rest := p[end+1:]
	if strings.HasPrefix(inner, "?") || strings.HasPrefix(inner, "(") {
		return nil, "", ErrUnsupported
	}
	var sels []selector
	for _, part := range splitUnion(inner) {
		part = strings.TrimSpace(part)
		sel, err := parseSelector(part)
		if err != nil {
			return nil, "", err
		}
		sels = append(sels, sel)
	}
	return sels, rest, nil
}

// quoteScanner walks a bracket's text, tracking quotes and escapes.
type quoteScanner struct{ quote byte }

// structural reports whether c at i is outside a quoted name, and how many
// bytes to skip after it.
func (q *quoteScanner) structural(s string, i int) (bool, int) {
	c := s[i]
	if q.quote == 0 {
		if c == '\'' || c == '"' {
			q.quote = c
			return false, 0
		}
		return true, 0
	}
	switch c {
	case '\\':
		return false, 1
	case q.quote:
		q.quote = 0
	}
	return false, 0
}

func closingBracket(p string) (int, error) {
	var q quoteScanner
	for i := 1; i < len(p); i++ {
		outside, skip := q.structural(p, i)
		i += skip
		if outside && p[i] == ']' {
			return i, nil
		}
	}
	return 0, errors.New("jsonpath: unclosed '['")
}

func splitUnion(s string) []string {
	var parts []string
	var q quoteScanner
	start := 0
	for i := 0; i < len(s); i++ {
		outside, skip := q.structural(s, i)
		i += skip
		if outside && s[i] == ',' {
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	return append(parts, s[start:])
}

func parseSelector(part string) (selector, error) {
	switch {
	case part == "*":
		return selector{kind: selWildcard}, nil
	case part == "":
		return selector{}, errors.New("jsonpath: empty selector")
	case len(part) >= 2 && (part[0] == '\'' || part[0] == '"') && part[len(part)-1] == part[0]:
		return selector{kind: selName, name: unescape(part[1 : len(part)-1])}, nil
	case strings.Contains(part, ":"):
		return parseSlice(part)
	}
	if n, err := strconv.Atoi(part); err == nil {
		return selector{kind: selIndex, index: n}, nil
	}
	return selector{kind: selName, name: part}, nil
}

func parseSlice(part string) (selector, error) {
	bits := strings.Split(part, ":")
	if len(bits) > 3 {
		return selector{}, fmt.Errorf("jsonpath: bad slice %q", part)
	}
	s := selector{kind: selSlice}
	ptrs := []**int{&s.start, &s.end, &s.step}
	for i, b := range bits {
		b = strings.TrimSpace(b)
		if b == "" {
			continue
		}
		n, err := strconv.Atoi(b)
		if err != nil {
			return selector{}, fmt.Errorf("jsonpath: bad slice %q", part)
		}
		*ptrs[i] = &n
	}
	return s, nil
}

func unescape(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) {
			i++
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

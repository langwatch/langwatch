package nodeprofile

import (
	"encoding/json"
	"errors"
	"fmt"
)

// HeapSnapshot is a V8 .heapsnapshot: flat node and edge tables described by
// the meta field lists, and the string table their names index.
type HeapSnapshot struct {
	NodeFields []string
	NodeTypes  []string
	EdgeFields []string
	EdgeTypes  []string
	Nodes      []uint32
	Edges      []uint32
	Strings    []string
}

type snapshotHead struct {
	Meta struct {
		NodeFields []string          `json:"node_fields"`
		NodeTypes  []json.RawMessage `json:"node_types"`
		EdgeFields []string          `json:"edge_fields"`
		EdgeTypes  []json.RawMessage `json:"edge_types"`
	} `json:"meta"`
}

// ParseHeapSnapshot decodes a .heapsnapshot. The node and edge tables are
// tens of millions of integers, so they are scanned by hand rather than
// through encoding/json, which would box every one.
func ParseHeapSnapshot(raw []byte) (*HeapSnapshot, error) {
	s := &HeapSnapshot{}
	i := skipWS(raw, 0)
	if i >= len(raw) || raw[i] != '{' {
		return nil, errors.New("not a heap snapshot: no top-level object")
	}
	end, err := s.readFields(raw, i+1)
	if err != nil {
		return nil, err
	}
	if end >= len(raw) {
		return nil, errors.New("not a heap snapshot: truncated")
	}
	if len(s.NodeFields) == 0 || len(s.EdgeFields) == 0 {
		return nil, errors.New("not a heap snapshot: no meta")
	}
	return s, nil
}

// readFields reads the top-level object's fields from i to its closing brace,
// whose index it returns (len(raw) when there is none).
func (s *HeapSnapshot) readFields(raw []byte, i int) (int, error) {
	for i = skipWS(raw, i); i < len(raw) && raw[i] != '}'; i = skipWS(raw, i) {
		if raw[i] == ',' {
			i++
			continue
		}
		next, err := s.readField(raw, i)
		if err != nil {
			return 0, err
		}
		i = next
	}
	return i, nil
}

// readField reads one top-level key and its value starting at i, and returns
// the index past the value.
func (s *HeapSnapshot) readField(raw []byte, i int) (int, error) {
	key, next, err := readKey(raw, i)
	if err != nil {
		return 0, err
	}
	i = skipWS(raw, next)
	var end int
	switch key {
	case "nodes":
		s.Nodes, end, err = readUintArray(raw, i)
	case "edges":
		s.Edges, end, err = readUintArray(raw, i)
	default:
		end, err = skipValue(raw, i)
		if err == nil {
			err = s.readJSONField(key, raw[i:end])
		}
	}
	if err != nil {
		return 0, fmt.Errorf("heap snapshot %s: %w", key, err)
	}
	return end, nil
}

func (s *HeapSnapshot) readJSONField(key string, value []byte) error {
	switch key {
	case "snapshot":
		return s.readMeta(value)
	case "strings":
		return json.Unmarshal(value, &s.Strings)
	}
	return nil
}

func (s *HeapSnapshot) readMeta(raw []byte) error {
	var head snapshotHead
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	m := head.Meta
	s.NodeFields, s.EdgeFields = m.NodeFields, m.EdgeFields
	if err := firstTypeList(m.NodeTypes, &s.NodeTypes); err != nil {
		return fmt.Errorf("node_types: %w", err)
	}
	if err := firstTypeList(m.EdgeTypes, &s.EdgeTypes); err != nil {
		return fmt.Errorf("edge_types: %w", err)
	}
	return nil
}

// firstTypeList decodes the enum of a meta type list: its first element.
func firstTypeList(list []json.RawMessage, into *[]string) error {
	if len(list) == 0 {
		return nil
	}
	return json.Unmarshal(list[0], into)
}

func isSpace(c byte) bool { return c == ' ' || c == '\n' || c == '\r' || c == '\t' }

func skipWS(b []byte, i int) int {
	for i < len(b) && isSpace(b[i]) {
		i++
	}
	return i
}

// readKey reads an object key and its colon; snapshot keys carry no escapes.
func readKey(b []byte, i int) (string, int, error) {
	if b[i] != '"' {
		return "", i, fmt.Errorf("expected a key at byte %d", i)
	}
	end := i + 1
	for end < len(b) && b[end] != '"' {
		end++
	}
	if end >= len(b) {
		return "", i, errors.New("truncated key")
	}
	key := string(b[i+1 : end])
	j := skipWS(b, end+1)
	if j >= len(b) || b[j] != ':' {
		return "", i, fmt.Errorf("expected ':' after %q", key)
	}
	return key, j + 1, nil
}

// skipValue returns the index just past the JSON value starting at i.
func skipValue(b []byte, i int) (int, error) {
	depth := 0
	for j := i; j < len(b); j++ {
		closes := false
		switch b[j] {
		case '"':
			j, closes = closingQuote(b, j), true
		case '{', '[':
			depth++
		case '}', ']':
			depth--
			closes = true
		case ',':
			closes = depth == 0
		}
		if end, done := valueEnd(b, scanAt{j: j, depth: depth, closes: closes}); done {
			return end, nil
		}
	}
	return 0, errors.New("truncated value")
}

// scanAt is where skipValue stands: the byte index, the nesting depth after
// it, and whether that byte closes something.
type scanAt struct {
	j, depth int
	closes   bool
}

// valueEnd decides whether the byte at.j ends the top-level value: a
// parent's ',' or bracket ends a bare scalar there, and a closing quote or
// bracket at depth 0 ends after itself.
func valueEnd(b []byte, at scanAt) (int, bool) {
	switch {
	case !at.closes || at.j >= len(b):
		return 0, false
	case at.depth < 0 || (at.depth == 0 && b[at.j] == ','):
		return at.j, true
	case at.depth == 0:
		return at.j + 1, true
	}
	return 0, false
}

// closingQuote is the index of the quote closing the string opened at i.
func closingQuote(b []byte, i int) int {
	j := i + 1
	for j < len(b) && b[j] != '"' {
		if b[j] == '\\' {
			j++
		}
		j++
	}
	return j
}

// readUintArray scans a JSON array of non-negative integers.
func readUintArray(b []byte, i int) ([]uint32, int, error) {
	if i >= len(b) || b[i] != '[' {
		return nil, i, errors.New("expected an array")
	}
	end, n := i, 1
	for end < len(b) && b[end] != ']' {
		if b[end] == ',' {
			n++
		}
		end++
	}
	if end >= len(b) {
		return nil, i, errors.New("truncated array")
	}
	out, err := parseUints(b[i+1:end], n)
	return out, end + 1, err
}

// parseUints reads comma-separated non-negative integers; n sizes the result.
func parseUints(b []byte, n int) ([]uint32, error) {
	out := make([]uint32, 0, n)
	var cur uint32
	inNum := false
	for _, c := range b {
		switch {
		case c >= '0' && c <= '9':
			cur, inNum = cur*10+uint32(c-'0'), true
		case c == ',':
			if inNum {
				out = append(out, cur)
			}
			cur, inNum = 0, false
		case !isSpace(c):
			return nil, fmt.Errorf("unexpected %q in an integer array", c)
		}
	}
	if inNum {
		out = append(out, cur)
	}
	return out, nil
}

package jsonc

import (
	"encoding/json"
	"strings"
)

// Strip drops comments and trailing commas so encoding/json can read a
// tsconfig, which TypeScript parses leniently.
func Strip(text string) string {
	var sb strings.Builder
	for i := 0; i < len(text); {
		switch {
		case text[i] == '"':
			end := skipString(text, i)
			sb.WriteString(text[i:end])
			i = end
		case strings.HasPrefix(text[i:], "//"), strings.HasPrefix(text[i:], "/*"):
			i = skipTrivia(text, i)
		case text[i] == ',' && nextIsClosing(text, i+1):
			i++
		default:
			sb.WriteByte(text[i])
			i++
		}
	}
	return sb.String()
}

func nextIsClosing(text string, i int) bool {
	i = skipTrivia(text, i)
	return i < len(text) && (text[i] == ']' || text[i] == '}')
}

func skipString(text string, start int) int {
	for i := start + 1; i < len(text); i++ {
		switch text[i] {
		case '\\':
			i++
		case '"':
			return i + 1
		}
	}
	return len(text)
}

const bom = "\xef\xbb\xbf"

// skipTrivia advances over whitespace and comments.
func skipTrivia(text string, i int) int {
	for i < len(text) {
		switch {
		case strings.ContainsRune(" \t\r\n", rune(text[i])):
			i++
		case strings.HasPrefix(text[i:], bom):
			i += len(bom)
		case strings.HasPrefix(text[i:], "//"):
			end := strings.IndexByte(text[i:], '\n')
			if end < 0 {
				return len(text)
			}
			i += end
		case strings.HasPrefix(text[i:], "/*"):
			end := strings.Index(text[i+2:], "*/")
			if end < 0 {
				return len(text)
			}
			i += end + 4
		default:
			return i
		}
	}
	return i
}

// skipValue returns the end of the JSON value starting at i.
func skipValue(text string, i int) int {
	switch {
	case i >= len(text):
		return i
	case text[i] == '"':
		return skipString(text, i)
	case text[i] == '{' || text[i] == '[':
		return skipContainer(text, i)
	}
	for i < len(text) && !strings.ContainsRune(",}] \t\r\n/", rune(text[i])) {
		i++
	}
	return i
}

// skipContainer returns the end of the object or array starting at i.
func skipContainer(text string, i int) int {
	depth := 0
	for i < len(text) {
		switch text[i] {
		case '"':
			i = skipString(text, i)
			continue
		case '/':
			if j := skipTrivia(text, i); j != i {
				i = j
				continue
			}
		case '{', '[':
			depth++
		case '}', ']':
			if depth--; depth == 0 {
				return i + 1
			}
		}
		i++
	}
	return i
}

// member is one top-level property: its key, where the key starts, and its value's span.
type member struct {
	key                            string
	keyStart, valueStart, valueEnd int
}

// memberAt reads the property whose key starts at i.
func memberAt(text string, i int) (member, bool) {
	if i >= len(text) || text[i] != '"' {
		return member{}, false
	}
	m := member{keyStart: i}
	keyEnd := skipString(text, i)
	if json.Unmarshal([]byte(text[i:keyEnd]), &m.key) != nil {
		return member{}, false
	}
	i = skipTrivia(text, keyEnd)
	if i >= len(text) || text[i] != ':' {
		return member{}, false
	}
	m.valueStart = skipTrivia(text, i+1)
	m.valueEnd = skipValue(text, m.valueStart)
	return m, true
}

// ReferencesSpan finds the top-level "references" property: where its key
// starts, and where its value starts and ends. ok is false when absent.
func ReferencesSpan(text string) (keyStart, valueStart, valueEnd int, ok bool) {
	i := skipTrivia(text, 0)
	if i >= len(text) || text[i] != '{' {
		return 0, 0, 0, false
	}
	for i++; ; i++ {
		m, found := memberAt(text, skipTrivia(text, i))
		if !found {
			return 0, 0, 0, false
		}
		if m.key == "references" {
			return m.keyStart, m.valueStart, m.valueEnd, true
		}
		if i = skipTrivia(text, m.valueEnd); i >= len(text) || text[i] != ',' {
			return 0, 0, 0, false
		}
	}
}

// Read parses a tsconfig-style JSONC object; anything unreadable is an empty object.
func Read(text string) map[string]any {
	var config map[string]any
	if json.Unmarshal([]byte(Strip(text)), &config) != nil || config == nil {
		return map[string]any{}
	}
	return config
}

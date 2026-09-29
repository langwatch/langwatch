package devscripts

import (
	"encoding/json"
	"strings"
)

// stripJSONC drops comments and trailing commas so encoding/json can read a
// tsconfig, which TypeScript parses leniently.
func stripJSONC(text string) string {
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
	if i >= len(text) {
		return i
	}
	if text[i] == '"' {
		return skipString(text, i)
	}
	if text[i] != '{' && text[i] != '[' {
		for i < len(text) && !strings.ContainsRune(",}] \t\r\n/", rune(text[i])) {
			i++
		}
		return i
	}
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
			depth--
			if depth == 0 {
				return i + 1
			}
		}
		i++
	}
	return i
}

// referencesSpan finds the top-level "references" property: where its key
// starts, and where its value starts and ends. ok is false when absent.
func referencesSpan(text string) (keyStart, valueStart, valueEnd int, ok bool) {
	i := skipTrivia(text, 0)
	if i >= len(text) || text[i] != '{' {
		return 0, 0, 0, false
	}
	i++
	for {
		i = skipTrivia(text, i)
		if i >= len(text) || text[i] != '"' {
			return 0, 0, 0, false
		}
		keyEnd := skipString(text, i)
		var key string
		if json.Unmarshal([]byte(text[i:keyEnd]), &key) != nil {
			return 0, 0, 0, false
		}
		start := i
		i = skipTrivia(text, keyEnd)
		if i >= len(text) || text[i] != ':' {
			return 0, 0, 0, false
		}
		i = skipTrivia(text, i+1)
		end := skipValue(text, i)
		if key == "references" {
			return start, i, end, true
		}
		i = skipTrivia(text, end)
		if i >= len(text) || text[i] != ',' {
			return 0, 0, 0, false
		}
		i++
	}
}

func readJSONC(text string) map[string]any {
	var config map[string]any
	if json.Unmarshal([]byte(stripJSONC(text)), &config) != nil || config == nil {
		return map[string]any{}
	}
	return config
}

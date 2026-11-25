package migrationorder

import (
	"regexp"
	"strings"
)

// identifier matches a method name at the start of the text.
var identifier = regexp.MustCompile(`^[\w$]*`)

// ownerCalls returns the `.method(...)` links of each receiver chain that
// starts at the owner's defineProcessModule in code, not in a comment.
func ownerCalls(content, owner, method string) []string {
	depths := codeDepths(content)
	definition := regexp.MustCompile(`\bdefineProcessModule\s*\(\s*` + quotedLiteral(owner) + `\s*,?\s*\)`)
	var calls []string
	for _, loc := range definition.FindAllStringIndex(content, -1) {
		if depths[loc[0]] < 0 {
			continue
		}
		for link, end, ok := nextLink(content, loc[1]); ok; link, end, ok = nextLink(content, end+1) {
			if link.method == method {
				calls = append(calls, link.call)
			}
		}
	}
	return calls
}

// chainLink is one `.method(...)` call of a receiver chain.
type chainLink struct{ method, call string }

// nextLink reads the link at pos, whitespace and comments allowed around
// the dot, the name and the bracket; ok is false where the chain ends.
func nextLink(content string, pos int) (link chainLink, end int, ok bool) {
	dot := skipSpace(content, pos)
	if !byteAt(content, dot, '.') {
		return chainLink{}, 0, false
	}
	start := skipSpace(content, dot+1)
	nameEnd := start + len(identifier.FindString(content[start:]))
	open := skipSpace(content, nameEnd)
	if nameEnd == start || !byteAt(content, open, '(') {
		return chainLink{}, 0, false
	}
	if end = closingParen(content, open); end < 0 {
		return chainLink{}, 0, false
	}
	return chainLink{method: content[start:nameEnd], call: content[dot : end+1]}, end, true
}

func byteAt(content string, i int, b byte) bool {
	return i < len(content) && content[i] == b
}

// skipSpace returns the first index at or after pos outside whitespace and comments.
func skipSpace(content string, pos int) int {
	for pos < len(content) {
		if next := skipComment(content, pos); next > pos {
			pos = min(next+1, len(content))
			continue
		}
		if !strings.ContainsRune(" \t\r\n", rune(content[pos])) {
			return pos
		}
		pos++
	}
	return pos
}

// codeDepths returns each byte's bracket depth in content, -1 inside a
// string literal or a comment.
func codeDepths(content string) []int {
	depths := make([]int, len(content))
	depth := 0
	for i := 0; i < len(content); i++ {
		if end := literalEnd(content, i); end > i {
			for j := i; j <= end && j < len(content); j++ {
				depths[j] = -1
			}
			i = end
			continue
		}
		switch content[i] {
		case '(', '{', '[':
			depth++
		case ')', '}', ']':
			depth--
		}
		depths[i] = depth
	}
	return depths
}

// literalEnd returns where the string or comment starting at i ends; i when none starts there.
func literalEnd(content string, i int) int {
	switch c := content[i]; c {
	case '"', '\'', '`':
		return skipString(content, i, c)
	case '/':
		return skipComment(content, i)
	}
	return i
}

// quotedLiteral matches value in any quote style.
func quotedLiteral(value string) string {
	quoted := regexp.QuoteMeta(value)
	return `(?:"` + quoted + `"|'` + quoted + `'|` + "`" + quoted + "`" + `)`
}

// closingParen returns the index of the bracket closing the one at open,
// skipping string literals and comments; -1 when it never closes.
func closingParen(content string, open int) int {
	depth := 0
	for i := open; i < len(content); i++ {
		switch c := content[i]; c {
		case '(', '{', '[':
			depth++
		case ')', '}', ']':
			depth--
			if depth == 0 {
				return i
			}
		case '"', '\'', '`':
			i = skipString(content, i, c)
		case '/':
			i = skipComment(content, i)
		}
	}
	return -1
}

func skipString(content string, start int, quote byte) int {
	for i := start + 1; i < len(content); i++ {
		switch content[i] {
		case '\\':
			i++
		case quote:
			return i
		}
	}
	return len(content)
}

func skipComment(content string, start int) int {
	rest := content[start:]
	switch {
	case strings.HasPrefix(rest, "//"):
		if end := strings.IndexByte(rest, '\n'); end >= 0 {
			return start + end
		}
		return len(content)
	case strings.HasPrefix(rest, "/*"):
		if end := strings.Index(rest[2:], "*/"); end >= 0 {
			return start + 2 + end + 1
		}
		return len(content)
	}
	return start
}

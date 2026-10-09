package lanediff

import "strings"

// skipString returns the index just past the string literal opening at i
// (quote is s[i]); template literals skip their ${...} holes recursively.
func skipString(s string, i int) int {
	quote := s[i]
	j := i + 1
	for j < len(s) {
		c := s[j]
		switch {
		case c == '\\':
			j += 2
			continue
		case c == quote:
			return j + 1
		case quote == '`' && c == '$' && j+1 < len(s) && s[j+1] == '{':
			end := matchClose(s, j+1)
			if end < 0 {
				return len(s)
			}
			j = end + 1
			continue
		case quote != '`' && c == '\n':
			return j
		}
		j++
	}
	return len(s)
}

// skipComment returns the index past a comment starting at i, or i when
// there is none.
func skipComment(s string, i int) int {
	if i+1 >= len(s) || s[i] != '/' {
		return i
	}
	switch s[i+1] {
	case '/':
		if end := strings.IndexByte(s[i:], '\n'); end >= 0 {
			return i + end + 1
		}
		return len(s)
	case '*':
		if end := strings.Index(s[i+2:], "*/"); end >= 0 {
			return i + 2 + end + 2
		}
		return len(s)
	}
	return i
}

// matchClose returns the index of the bracket closing the one at open, or -1.
func matchClose(s string, open int) int {
	depth := 0
	end := walkCode(s, open, func(i int) bool {
		depth += bracketDelta(s[i])
		return depth != 0
	})
	if end >= len(s) {
		return -1
	}
	return end
}

// walkCode calls visit for each byte from start that is outside a string or
// comment, until visit returns false; it returns that index or len(s).
func walkCode(s string, start int, visit func(i int) bool) int {
	for i := start; i < len(s); {
		if next := skipNoise(s, i); next != i {
			i = next
			continue
		}
		if !visit(i) {
			return i
		}
		i++
	}
	return len(s)
}

// skipNoise returns the index past a string or comment at i, or i.
func skipNoise(s string, i int) int {
	switch s[i] {
	case '"', '\'', '`':
		return skipString(s, i)
	case '/':
		return skipComment(s, i)
	}
	return i
}

func bracketDelta(c byte) int {
	switch c {
	case '(', '{', '[':
		return 1
	case ')', '}', ']':
		return -1
	}
	return 0
}

// skipGenerics returns the index past a `<...>` type-argument list at i, or i.
func skipGenerics(s string, i int) int {
	if i >= len(s) || s[i] != '<' {
		return i
	}
	depth := 0
	for j := i; j < len(s); j++ {
		if s[j] == ';' {
			return i
		}
		depth += angleDelta(s, j)
		if depth == 0 {
			return j + 1
		}
	}
	return i
}

// angleDelta counts `<` and `>`, but not the `>` of an arrow.
func angleDelta(s string, j int) int {
	switch {
	case s[j] == '<':
		return 1
	case s[j] == '>' && (j == 0 || s[j-1] != '='):
		return -1
	}
	return 0
}

func skipSpace(s string, i int) int {
	for i < len(s) {
		switch s[i] {
		case ' ', '\t', '\n', '\r':
			i++
		case '/':
			next := skipComment(s, i)
			if next == i {
				return i
			}
			i = next
		default:
			return i
		}
	}
	return i
}

// splitTopLevel splits s on commas outside every bracket and string.
func splitTopLevel(s string) []string {
	var parts []string
	depth, start := 0, 0
	walkCode(s, 0, func(i int) bool {
		depth += bracketDelta(s[i])
		if s[i] == ',' && depth == 0 {
			parts = append(parts, strings.TrimSpace(s[start:i]))
			start = i + 1
		}
		return true
	})
	if tail := strings.TrimSpace(s[start:]); tail != "" {
		parts = append(parts, tail)
	}
	return parts
}

// callArgs reads the arguments of the call whose '(' is at open.
func callArgs(s string, open int) ([]string, int) {
	end := matchClose(s, open)
	if end < 0 {
		return nil, -1
	}
	return splitTopLevel(s[open+1 : end]), end
}

// objectProps reads the top-level `key: value` pairs (and shorthand keys) of
// an object literal; a spread or method is skipped.
func objectProps(obj string) map[string]string {
	obj = strings.TrimSpace(obj)
	if !strings.HasPrefix(obj, "{") {
		return nil
	}
	end := matchClose(obj, 0)
	if end < 0 {
		return nil
	}
	props := map[string]string{}
	for _, part := range splitTopLevel(obj[1:end]) {
		if strings.HasPrefix(part, "...") {
			continue
		}
		colon := topLevelColon(part)
		if colon < 0 {
			if isIdent(part) {
				props[part] = part
			}
			continue
		}
		key := strings.Trim(strings.TrimSpace(part[:colon]), `"'`)
		props[key] = strings.TrimSpace(part[colon+1:])
	}
	return props
}

func topLevelColon(s string) int {
	depth := 0
	end := walkCode(s, 0, func(i int) bool {
		depth += bracketDelta(s[i]) + angleDelta(s, i)
		return s[i] != ':' || depth != 0
	})
	if end >= len(s) {
		return -1
	}
	return end
}

func isIdent(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		ok := r == '_' || r == '$' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (i > 0 && r >= '0' && r <= '9')
		if !ok {
			return false
		}
	}
	return true
}

// lineOf returns the 1-based line number of offset i.
func lineOf(s string, i int) int {
	return strings.Count(s[:i], "\n") + 1
}

// stripComments blanks every comment, keeping offsets and line numbers.
func stripComments(s string) string {
	out := []byte(s)
	for i := 0; i < len(s); {
		next := skipNoise(s, i)
		if next == i {
			i++
			continue
		}
		if s[i] == '/' {
			blank(out, i, next)
		}
		i = next
	}
	return string(out)
}

func blank(out []byte, from, to int) {
	for j := from; j < to; j++ {
		if out[j] != '\n' {
			out[j] = ' '
		}
	}
}

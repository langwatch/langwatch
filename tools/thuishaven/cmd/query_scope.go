package cmd

import (
	"fmt"
	"strings"
)

// One collector serves every worktree on the machine, so a raw query is
// rewritten before it is sent: every selector gains this worktree's filter.
// The rewrite is lexical (strings skipped, braces matched), not a parser; a
// query it cannot follow is sent as written and the backend reports the error.

// scopeQuery forces the worktree filter into every selector of a raw query.
func scopeQuery(lang queryLang, query, slug string) string {
	switch lang {
	case langTraceQL:
		return rewriteBraces(query, func(inner string) string { return scopeSpanset(inner, slug) })
	case langLogQL:
		return rewriteBraces(query, func(inner string) string {
			return fmt.Sprintf("{%s} | langwatch_worktree=%q", inner, slug)
		})
	case langPromQL:
		return scopePromQL(query, slug)
	}
	return query
}

// scopeSpanset ANDs the worktree resource attribute into one TraceQL spanset.
func scopeSpanset(inner, slug string) string {
	filter := fmt.Sprintf("resource.langwatch.worktree = %q", slug)
	if strings.TrimSpace(inner) == "" {
		return "{ " + filter + " }"
	}
	return "{ " + filter + " && (" + inner + ") }"
}

// rewriteBraces replaces every top-level {inner} outside string literals.
func rewriteBraces(query string, replace func(inner string) string) string {
	var out strings.Builder
	for i := 0; i < len(query); {
		switch {
		case isQuote(query[i]):
			end := stringEnd(query, i)
			out.WriteString(query[i:end])
			i = end
		case query[i] == '{':
			end := closingBrace(query, i)
			if end < 0 {
				out.WriteString(query[i:])
				return out.String()
			}
			out.WriteString(replace(query[i+1 : end]))
			i = end + 1
		default:
			out.WriteByte(query[i])
			i++
		}
	}
	return out.String()
}

func isQuote(c byte) bool { return c == '"' || c == '\'' || c == '`' }

// stringEnd returns the index just past the string literal opening at start.
func stringEnd(query string, start int) int {
	quote := query[start]
	for i := start + 1; i < len(query); i++ {
		if query[i] == '\\' && quote != '`' {
			i++
			continue
		}
		if query[i] == quote {
			return i + 1
		}
	}
	return len(query)
}

// closingBrace returns the index of the } closing the { at start, or -1.
func closingBrace(query string, start int) int {
	for i := start + 1; i < len(query); {
		if isQuote(query[i]) {
			i = stringEnd(query, i)
			continue
		}
		if query[i] == '}' {
			return i
		}
		i++
	}
	return -1
}

// promLabelListKeywords are followed by a parenthesised label list, not series.
var promLabelListKeywords = map[string]bool{
	"by": true, "without": true, "on": true, "ignoring": true, "group_left": true, "group_right": true,
}

// promKeywords are operators, literals and aggregations (which may be followed
// by `by (...)` rather than a paren) that read like metric names.
var promKeywords = map[string]bool{
	"and": true, "or": true, "unless": true, "bool": true, "offset": true, "atan2": true, "inf": true, "nan": true,
	"sum": true, "min": true, "max": true, "avg": true, "group": true, "stddev": true, "stdvar": true,
	"count": true, "count_values": true, "bottomk": true, "topk": true, "quantile": true,
	"limitk": true, "limit_ratio": true,
}

// scopePromQL adds the worktree matcher to every vector selector, braced or bare.
func scopePromQL(query, slug string) string {
	matcher := fmt.Sprintf("langwatch_worktree=%q", slug)
	var out strings.Builder
	for i := 0; i < len(query); {
		next, piece := promToken(query, i, matcher)
		out.WriteString(piece)
		i = next
	}
	return out.String()
}

// promToken reads one token at i and returns where the next starts and its
// scoped spelling.
func promToken(query string, i int, matcher string) (int, string) {
	c := query[i]
	switch {
	case isQuote(c):
		end := stringEnd(query, i)
		return end, query[i:end]
	case c == '{':
		end := closingBrace(query, i)
		if end < 0 {
			return len(query), query[i:]
		}
		return end + 1, "{" + joinMatchers(matcher, query[i+1:end]) + "}"
	case c == '[':
		end := strings.IndexByte(query[i:], ']')
		if end < 0 {
			return len(query), query[i:]
		}
		return i + end + 1, query[i : i+end+1]
	case isDigit(c):
		end := wordEnd(query, i)
		return end, query[i:end]
	case isIdentStart(c):
		return promIdent(query, i, matcher)
	}
	return i + 1, string(c)
}

// joinMatchers prepends the forced matcher to a selector's own.
func joinMatchers(matcher, inner string) string {
	if strings.TrimSpace(inner) == "" {
		return matcher
	}
	return matcher + ", " + inner
}

// promIdent classifies the identifier at i: a keyword, a function, or a metric
// name, which gains the matcher when it has no braces of its own.
func promIdent(query string, i int, matcher string) (int, string) {
	end := wordEnd(query, i)
	ident := query[i:end]
	after := strings.TrimLeft(query[end:], " \t\n")
	lower := strings.ToLower(ident)
	switch {
	case promLabelListKeywords[lower] && strings.HasPrefix(after, "("):
		paren := strings.IndexByte(query[end:], ')')
		if paren < 0 {
			return len(query), query[i:]
		}
		return end + paren + 1, query[i : end+paren+1]
	case promKeywords[lower], strings.HasPrefix(after, "("), strings.HasPrefix(after, "{"):
		return end, ident
	}
	return end, ident + "{" + matcher + "}"
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func isIdentStart(c byte) bool {
	return c == '_' || c == ':' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

// wordEnd returns the index past the run of identifier characters (and the dots
// of a number) starting at i.
func wordEnd(query string, i int) int {
	for i < len(query) && (isIdentStart(query[i]) || isDigit(query[i]) || query[i] == '.') {
		i++
	}
	return i
}

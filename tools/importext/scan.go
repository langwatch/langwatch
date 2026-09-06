package importext

import (
	"regexp"
	"strings"
)

// occurrence is one quoted module specifier found in a source file.
type occurrence struct {
	start, end int // byte range of the specifier text, excluding the quotes
	specifier  string
	line       int
}

// specifierPatterns are the syntactic forms whose specifier importext rewrites.
// Every pattern ends in two alternative groups, one per quote style, and
// exactly one of the two captures the specifier text.
var specifierPatterns = []*regexp.Regexp{
	regexp.MustCompile(`\bfrom\s*(?:'([^'\n]*)'|"([^"\n]*)")`),
	regexp.MustCompile(`(?m)^[\t ]*import\s*(?:'([^'\n]*)'|"([^"\n]*)")`),
	regexp.MustCompile(`\bimport\s*\(\s*(?:'([^'\n]*)'|"([^"\n]*)")`),
	regexp.MustCompile(`\bvi\.(?:mock|doMock|importActual|importMock)\s*\(\s*(?:'([^'\n]*)'|"([^"\n]*)")`),
	regexp.MustCompile(`\brequire\.resolve\s*\(\s*(?:'([^'\n]*)'|"([^"\n]*)")`),
}

// findOccurrences returns every module specifier in source, ordered by position
// and de-duplicated where two patterns match the same quoted string.
func findOccurrences(source string) []occurrence {
	collect := &collector{seen: make(map[int]bool), source: source}
	for _, pattern := range specifierPatterns {
		collect.add(pattern)
	}
	sortByStart(collect.found)
	return collect.found
}

// collector gathers the matches of every pattern over one source file.
type collector struct {
	source string
	seen   map[int]bool
	found  []occurrence
}

func (c *collector) add(pattern *regexp.Regexp) {
	for _, match := range pattern.FindAllStringSubmatchIndex(c.source, -1) {
		start, end := capturedSpecifier(match)
		if start < 0 || c.seen[start] {
			continue
		}
		c.seen[start] = true
		c.found = append(c.found, occurrence{
			start:     start,
			end:       end,
			specifier: c.source[start:end],
			line:      1 + strings.Count(c.source[:start], "\n"),
		})
	}
}

// capturedSpecifier returns the byte range of whichever quote-style group matched.
func capturedSpecifier(match []int) (int, int) {
	for index := 2; index+1 < len(match); index += 2 {
		if match[index] >= 0 {
			return match[index], match[index+1]
		}
	}
	return -1, -1
}

func sortByStart(items []occurrence) {
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j].start < items[j-1].start; j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
}

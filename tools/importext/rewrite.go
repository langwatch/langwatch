package importext

import (
	"path/filepath"
	"regexp"
	"strings"
)

// importAttribute matches the `with { type: "json" }` clause that follows a
// specifier, starting at its closing quote.
var importAttribute = regexp.MustCompile(`^.\s*(?:with|assert)\s*\{`)

// hasImportAttribute reports whether the specifier ending at closingQuote
// carries an import attribute clause.
func hasImportAttribute(source string, closingQuote int) bool {
	rest := source[closingQuote:]
	if newline := strings.IndexByte(rest, '\n'); newline >= 0 {
		rest = rest[:newline]
	}
	return importAttribute.MatchString(rest)
}

// classification is what importext decided about one specifier.
type classification int

const (
	classIgnore classification = iota
	classAlias
	classJSON
	classResolvable
)

// classify decides how one specifier is treated. Only relative module
// specifiers are candidates for a rewrite.
func classify(specifier string) classification {
	switch {
	case isAlias(specifier):
		return classAlias
	case !isRelative(specifier), hasQuery(specifier):
		return classIgnore
	case strings.EqualFold(filepath.Ext(specifier), ".json"):
		return classJSON
	case isAsset(specifier):
		return classIgnore
	default:
		return classResolvable
	}
}

// planner rewrites one file's specifiers.
type planner struct {
	source       string
	dir          string
	relativePath string
	report       *Report
}

// run returns the rewritten source and every change it holds. The source is
// copied byte for byte apart from the specifier text itself.
func (p *planner) run() (string, []Change) {
	source := p.source
	var builder strings.Builder
	var changes []Change
	cursor := 0
	for _, item := range findOccurrences(source) {
		replacement := p.decide(item)
		if replacement == "" || replacement == item.specifier {
			continue
		}
		builder.WriteString(source[cursor:item.start])
		builder.WriteString(replacement)
		cursor = item.end
		changes = append(changes, Change{Line: item.line, From: item.specifier, To: replacement})
	}
	if len(changes) == 0 {
		return source, nil
	}
	builder.WriteString(source[cursor:])
	return builder.String(), changes
}

// decide returns the specifier to write in place of item, or "" to leave it.
func (p *planner) decide(item occurrence) string {
	finding := Finding{File: p.relativePath, Line: item.line, Specifier: item.specifier}
	switch classify(item.specifier) {
	case classAlias:
		p.report.AliasImports = append(p.report.AliasImports, finding)
		return ""
	case classJSON:
		if !hasImportAttribute(p.source, item.end) {
			p.report.JSONImports = append(p.report.JSONImports, finding)
		}
		return ""
	case classResolvable:
		resolved := resolve(p.dir, item.specifier)
		if resolved == "" {
			p.report.Unresolved = append(p.report.Unresolved, finding)
		}
		return resolved
	default:
		return ""
	}
}

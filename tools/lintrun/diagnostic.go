// Package lintrun is the oxlint runner behind `pnpm lint`, `pnpm lint:changed`
// and `pnpm lint:types`: native rules and the langwatch plugin as two parallel
// processes, plus the type-aware rules as a third under --types, with one
// unused-directive check across them. ADR-150, dev/docs/TOOLING.md.
package lintrun

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// Span is where a label points, as oxlint's `-f json` prints it.
type Span struct {
	Offset int `json:"offset"`
	Length int `json:"length"`
	Line   int `json:"line"`
	Column int `json:"column"`
}

// Label is one span a diagnostic points at.
type Label struct {
	Span *Span `json:"span,omitempty"`
}

// Diagnostic is one entry of oxlint's `-f json` report. Code is nil for an
// unused-directive report, which names no rule.
type Diagnostic struct {
	Message  string  `json:"message"`
	Code     *string `json:"code,omitempty"`
	Severity string  `json:"severity,omitempty"`
	Help     *string `json:"help,omitempty"`
	Filename string  `json:"filename"`
	Labels   []Label `json:"labels,omitempty"`
}

var (
	directive = regexp.MustCompile(`^Unused (?:eslint|oxlint)-[a-z-]+ directive \((?P<detail>.*)\)\.$`)
	fromRule  = regexp.MustCompile(`^no problems were reported from `)
)

// span is the first label's span, or the zero span when there is none.
func (d Diagnostic) span() Span {
	if len(d.Labels) == 0 || d.Labels[0].Span == nil {
		return Span{}
	}
	return *d.Labels[0].Span
}

func (d Diagnostic) key() string {
	return fmt.Sprintf("%s\x00%d\x00%s", d.Filename, d.span().Offset, d.Message)
}

func isDirective(d Diagnostic) bool {
	return d.Code == nil && directive.MatchString(d.Message)
}

func isPerRule(d Diagnostic) bool {
	m := directive.FindStringSubmatch(d.Message)
	detail := directive.SubexpIndex("detail")
	return len(m) > detail && fromRule.MatchString(m[detail])
}

// covers reports whether a whole-directive report's comment holds a per-rule report's span.
func covers(whole, rule Diagnostic) bool {
	outer, inner := whole.span(), rule.span().Offset
	return whole.Filename == rule.Filename && outer.Offset <= inner && inner < outer.Offset+outer.Length
}

// MergeDiagnostics merges the reports of processes that linted the same files with
// disjoint rule sets: every finding, plus the unused-directive reports all agree on.
// A per-rule report also stands where another process found the whole directive
// unused, since that process used none of the directive's rules.
func MergeDiagnostics(reports [][]Diagnostic) []Diagnostic {
	out := []Diagnostic{}
	directives := make([][]Diagnostic, len(reports))
	for i, report := range reports {
		for _, d := range report {
			if isDirective(d) {
				directives[i] = append(directives[i], d)
			} else {
				out = append(out, d)
			}
		}
	}
	for _, d := range uniqueDirectives(directives) {
		if agreed(d, directives) {
			out = append(out, d)
		}
	}
	return out
}

// uniqueDirectives is one report per key, in first-seen order, holding the last seen, as a JS Map does.
func uniqueDirectives(directives [][]Diagnostic) []Diagnostic {
	index := map[string]int{}
	var out []Diagnostic
	for _, d := range slices.Concat(directives...) {
		if i, seen := index[d.key()]; seen {
			out[i] = d
			continue
		}
		index[d.key()] = len(out)
		out = append(out, d)
	}
	return out
}

// agreed reports whether every process reported d, or a whole directive covering it.
func agreed(d Diagnostic, directives [][]Diagnostic) bool {
	return !slices.ContainsFunc(directives, func(report []Diagnostic) bool {
		return !slices.ContainsFunc(report, func(other Diagnostic) bool {
			return other.key() == d.key() || (isPerRule(d) && !isPerRule(other) && covers(other, d))
		})
	})
}

// SortByPosition orders diagnostics by file, line and column, keeping ties in place.
// Files compare byte-wise; the JS runner used localeCompare.
func SortByPosition(ds []Diagnostic) {
	sort.SliceStable(ds, func(i, j int) bool {
		a, b := ds[i], ds[j]
		if a.Filename != b.Filename {
			return a.Filename < b.Filename
		}
		sa, sb := a.span(), b.span()
		if sa.Line != sb.Line {
			return sa.Line < sb.Line
		}
		return sa.Column < sb.Column
	})
}

// Format prints one diagnostic as `file:line:col: message [rule]`, then its help.
func Format(d Diagnostic) string {
	var b strings.Builder
	s := d.span()
	fmt.Fprintf(&b, "%s:%d:%d: %s", d.Filename, s.Line, s.Column, d.Message)
	if d.Code != nil {
		fmt.Fprintf(&b, " [%s]", *d.Code)
	}
	if d.Help != nil {
		fmt.Fprintf(&b, "\n  help: %s", *d.Help)
	}
	return b.String()
}

// Summary is the whole printed output: each diagnostic, a blank line, the count.
func Summary(ds []Diagnostic) string {
	var b strings.Builder
	for _, d := range ds {
		b.WriteString(Format(d))
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "\n%d problem(s)\n", len(ds))
	return b.String()
}

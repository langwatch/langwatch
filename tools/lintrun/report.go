package lintrun

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"
)

var (
	unused     = regexp.MustCompile(`^Unused (?:eslint|oxlint)-[a-z-]+ directive`)
	namedRules = regexp.MustCompile(`(?m)disable(?:-next-line|-line)?\s+([^*\n]*?)(?:\s+--|\*/|$)`)
)

// noFiles is what oxlint prints, exiting 1, when every path it was given matched an
// ignore pattern. That is a clean run, not a failure (langwatch#9094).
const noFiles = "No files found to lint."

// RuleName is a configured rule's bare name: `typescript/no-floating-promises` -> `no-floating-promises`.
func RuleName(rule string) string {
	parts := strings.Split(strings.TrimSpace(rule), "/")
	return parts[len(parts)-1]
}

// JudgedWithoutTypes reports whether a run without the type-aware rules can judge a
// diagnostic: an unused-directive report whose directive names only type-aware rules
// cannot be. source is the file's bytes; typeOnly holds bare rule names.
func JudgedWithoutTypes(d Diagnostic, source []byte, typeOnly map[string]bool) bool {
	if d.Code != nil || !unused.MatchString(d.Message) {
		return true
	}
	s := d.span()
	start, end := min(s.Offset, len(source)), min(s.Offset+s.Length, len(source))
	names := directiveRules(string(source[start:end]))
	return len(names) == 0 || slices.ContainsFunc(names, func(name string) bool { return !typeOnly[name] })
}

// directiveRules is the bare rule names a disable directive's comment lists.
func directiveRules(comment string) []string {
	m := namedRules.FindStringSubmatch(comment)
	if m == nil {
		return nil
	}
	var names []string
	for _, rule := range strings.Split(m[1], ",") {
		if name := RuleName(rule); name != "" {
			names = append(names, name)
		}
	}
	return names
}

// ParseReport reads one oxlint `-f json` run. ok is false when oxlint failed to run:
// an exit other than 0 or 1, or output that is not a report. "No files found to lint."
// is a clean run only when the report after it shows no files linted and no findings.
func ParseReport(stdout string, status int) (diagnostics []Diagnostic, ok bool) {
	if status != 0 && status != 1 {
		return nil, false
	}
	body := strings.TrimLeft(stdout, " \t\r\n")
	noneFound := strings.HasPrefix(body, noFiles)
	if noneFound { // the sentence runs on to the end of its line, then the report follows
		_, body, _ = strings.Cut(body, "\n")
	}
	var report struct {
		Diagnostics   *[]Diagnostic `json:"diagnostics"`
		NumberOfFiles *int          `json:"number_of_files"`
	}
	if err := json.Unmarshal([]byte(body), &report); err != nil || report.Diagnostics == nil {
		return nil, false
	}
	if noneFound && (report.NumberOfFiles == nil || *report.NumberOfFiles != 0 || len(*report.Diagnostics) > 0) {
		return nil, false
	}
	return *report.Diagnostics, true
}

package visualdiff

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// volatilePatterns are replaced in order: dates and times before the bare
// digits they contain, ids before the digit rule would half-mask them.
var volatilePatterns = []struct {
	pattern     *regexp.Regexp
	replacement string
}{
	{regexp.MustCompile(`\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?`), "<date>"},
	{regexp.MustCompile(`(?i)\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?`), "<date>"},
	{regexp.MustCompile(`\b\d{1,2}/\d{1,2}/\d{2,4}\b`), "<date>"},
	{regexp.MustCompile(`(?i)\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?`), "<time>"},
	{regexp.MustCompile(`(?i)\b(?:about |almost |over |less than )?(?:\d+|an?|a few) (?:seconds?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?) ago\b`), "<rel>"},
	{regexp.MustCompile(`(?i)\bin (?:\d+|an?|a few) (?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b`), "<rel>"},
	{regexp.MustCompile(`(?i)\b(?:just now|yesterday|today|tomorrow)\b`), "<rel>"},
	{regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`), "<id>"},
	{regexp.MustCompile(`\b[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]*[A-Za-z][A-Za-z0-9_-]*\b|\b[A-Za-z0-9_-]*[A-Za-z][A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]*\b`), "<id>"},
	{regexp.MustCompile(`\d+(?:[.,]\d+)*`), "#"},
}

// MaskVolatile replaces dates, times, relative times, ids and digits, the
// parts of a screen that differ between two identical renders.
func MaskVolatile(value string) string {
	for _, rule := range volatilePatterns {
		value = rule.pattern.ReplaceAllStringFunc(value, func(match string) string {
			if rule.replacement == "<id>" && len(match) < 12 {
				return match
			}
			return rule.replacement
		})
	}
	return value
}

// controlRoles are the roles whose presence is the screen's contract: a
// missing one is a finding, where different words are only copy.
var controlRoles = map[string]bool{
	"button": true, "link": true, "heading": true, "tab": true,
	"checkbox": true, "switch": true, "textbox": true, "combobox": true,
}

// ariaLine is one node line of a Playwright aria snapshot: `- role "name" [attrs]`.
var ariaLine = regexp.MustCompile(`^-\s+([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?`)

const maxControlName = 60

// TextDiff is one screen's text evidence: the controls only one side has,
// and whether the words differ once the volatile parts are masked. Compared
// is false when either side has no snapshot, and then nothing is concluded.
type TextDiff struct {
	Compared    bool     `json:"compared"`
	Missing     []string `json:"missing,omitempty"`
	Added       []string `json:"added,omitempty"`
	CopyChanged bool     `json:"copyChanged,omitempty"`
}

// ControlsChanged reports a control present on one side only.
func (diff TextDiff) ControlsChanged() bool { return len(diff.Missing)+len(diff.Added) > 0 }

// Summary is the role diff on one line: `-button "Save"; +link "Docs"`.
func (diff TextDiff) Summary() string {
	parts := make([]string, 0, len(diff.Missing)+len(diff.Added))
	for _, control := range diff.Missing {
		parts = append(parts, "-"+control)
	}
	for _, control := range diff.Added {
		parts = append(parts, "+"+control)
	}
	const shown = 6
	if len(parts) > shown {
		return strings.Join(parts[:shown], "; ") + fmt.Sprintf("; and %d more", len(parts)-shown)
	}
	return strings.Join(parts, "; ")
}

// CompareText diffs two aria snapshots: the controls as a multiset of
// role and masked name, the rest as masked text.
func CompareText(base, candidate string) TextDiff {
	if strings.TrimSpace(base) == "" || strings.TrimSpace(candidate) == "" {
		return TextDiff{}
	}
	baseControls, candidateControls := controls(base), controls(candidate)
	diff := TextDiff{
		Compared: true,
		Missing:  subtract(baseControls, candidateControls),
		Added:    subtract(candidateControls, baseControls),
	}
	diff.CopyChanged = maskedText(base) != maskedText(candidate)
	return diff
}

func controls(snapshot string) map[string]int {
	found := map[string]int{}
	for _, line := range strings.Split(snapshot, "\n") {
		match := ariaLine.FindStringSubmatch(strings.TrimSpace(line))
		if len(match) < 3 || !controlRoles[match[1]] {
			continue
		}
		name := MaskVolatile(match[2])
		if len(name) > maxControlName {
			name = name[:maxControlName] + "…"
		}
		found[fmt.Sprintf("%s %q", match[1], name)]++
	}
	return found
}

// subtract lists every control from counts beyond what other has, sorted.
func subtract(counts, other map[string]int) []string {
	var out []string
	for control, count := range counts {
		for extra := count - other[control]; extra > 0; extra-- {
			out = append(out, control)
		}
	}
	sort.Strings(out)
	return out
}

func maskedText(snapshot string) string {
	lines := strings.Split(snapshot, "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "- /url:") {
			continue
		}
		kept = append(kept, strings.TrimRight(line, " "))
	}
	return MaskVolatile(strings.Join(kept, "\n"))
}

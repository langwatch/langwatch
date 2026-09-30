package enforcer

import (
	"fmt"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/internal/collate"
)

// findingCap is how many findings one policy prints before the rest are counted.
const findingCap = 25

type group struct {
	policy   string
	findings []Violation
}

// sortFindings is lintPolicies' order: `file:line:policy` by localeCompare, stable.
func sortFindings(findings []Violation) {
	key := func(v Violation) string { return fmt.Sprintf("%s:%d:%s", v.File, v.Line, v.Policy) }
	sort.SliceStable(findings, func(i, j int) bool { return collate.Compare(key(findings[i]), key(findings[j])) < 0 })
}

func groupByPolicy(findings []Violation) []group {
	index := map[string]int{}
	var groups []group
	for _, f := range findings {
		i, ok := index[f.Policy]
		if !ok {
			i = len(groups)
			index[f.Policy] = i
			groups = append(groups, group{policy: f.Policy})
		}
		groups[i].findings = append(groups[i].findings, f)
	}
	sort.SliceStable(groups, func(i, j int) bool {
		if len(groups[i].findings) != len(groups[j].findings) {
			return len(groups[i].findings) > len(groups[j].findings)
		}
		return collate.Compare(groups[i].policy, groups[j].policy) < 0
	})
	return groups
}

func plural(count int, noun string) string {
	if count == 1 {
		return fmt.Sprintf("%d %s", count, noun)
	}
	return fmt.Sprintf("%d %ss", count, noun)
}

func formatFinding(f Violation) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "[%s] %s", f.Policy, f.File)
	if f.Line != 0 {
		fmt.Fprintf(&sb, ":%d", f.Line)
	}
	if f.Specifier != "" {
		fmt.Fprintf(&sb, " (%s)", f.Specifier)
	}
	fmt.Fprintf(&sb, "\n  %s", f.Message)
	if f.Allowed != "" {
		fmt.Fprintf(&sb, "\n  allowed: %s", f.Allowed)
	}
	return sb.String()
}

// formatReport is report.ts formatReport for a run with findings.
func formatReport(findings []Violation, all bool) string {
	groups := groupByPolicy(findings)
	lines := summaryLines(groups, len(findings), all)
	for _, g := range groups {
		lines = append(lines, groupLines(g, all)...)
	}
	return strings.Join(lines, "\n") + "\n"
}

// summaryLines is the report's head: totals, one count per policy, and the cap notice.
func summaryLines(groups []group, total int, all bool) []string {
	policies := fmt.Sprintf("%d policies", len(groups))
	if len(groups) == 1 {
		policies = "1 policy"
	}
	lines := []string{fmt.Sprintf("architecture-enforcer: %s across %s, exit 1 (%s)", plural(total, "finding"), policies, plural(total, "finding"))}
	overCap := false
	for _, g := range groups {
		lines = append(lines, fmt.Sprintf("  %5d  %s", len(g.findings), g.policy))
		overCap = overCap || len(g.findings) > findingCap
	}
	if overCap && !all {
		lines = append(lines, fmt.Sprintf("  showing at most %d findings per policy; pass --all for every one", findingCap))
	}
	return lines
}

// groupLines is one policy's section, capped unless all.
func groupLines(g group, all bool) []string {
	shown := g.findings
	if !all && len(shown) > findingCap {
		shown = shown[:findingCap]
	}
	rendered := make([]string, len(shown))
	for i, f := range shown {
		rendered[i] = formatFinding(f)
	}
	lines := []string{"", fmt.Sprintf("--- %s: %s ---", g.policy, plural(len(g.findings), "finding")), "", strings.Join(rendered, "\n\n")}
	if hidden := len(g.findings) - len(shown); hidden > 0 {
		lines = append(lines, "", fmt.Sprintf("  %s from %s, hidden by the cap", plural(hidden, "further finding"), g.policy))
	}
	return lines
}

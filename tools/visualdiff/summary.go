package visualdiff

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// SummaryFile is the run's short text verdict, the first thing to read.
const SummaryFile = "summary.txt"

// summaryTop is how many findings summary.txt spells out one line each.
const summaryTop = 20

// summaryUncovered is how many uncovered patterns summary.txt lists by name.
const summaryUncovered = 60

// classOrder ranks classes worst-first, for the table and the top findings.
var classOrder = []Classification{
	ClassMissingBase, ClassMissingCandidate, ClassCaptureFailed, ClassRegression, ClassBrokenBoth, ClassBlank,
	ClassNotFound, ClassAPIError, ClassRedirect, ClassControls, ClassUncovered,
	ClassCopy, ClassChanged, ClassIntendedRestore, ClassNoise,
}

func classRank(class Classification) int {
	for index, known := range classOrder {
		if known == class {
			return index
		}
	}
	return len(classOrder)
}

// SummaryInputs is everything summary.txt says.
type SummaryInputs struct {
	BaseRef      string
	CandidateRef string
	Editions     []Edition
	Rows         []Row
	Coverage     *Coverage
}

// RenderSummary is the triage text: counts by class and edition, coverage,
// the worst findings one line each with their text evidence, and every
// uncovered route.
func RenderSummary(inputs SummaryInputs) string {
	var out strings.Builder
	findings := findingRows(inputs.Rows)
	uncovered := 0
	if inputs.Coverage != nil {
		uncovered = len(inputs.Coverage.Uncovered())
	}
	fmt.Fprintf(&out, "visualdiff %s vs %s: %d screens, %d findings\n",
		inputs.BaseRef, inputs.CandidateRef, len(inputs.Rows), len(findings)+uncovered)
	if inputs.Coverage != nil {
		fmt.Fprintln(&out, inputs.Coverage.Line())
	}
	writeClassTable(&out, inputs)
	if len(findings) > 0 {
		fmt.Fprintf(&out, "\nfindings (worst %d of %d):\n", min(summaryTop, len(findings)), len(findings))
		for index := range findings[:min(summaryTop, len(findings))] {
			fmt.Fprintf(&out, "%2d. %s\n", index+1, findingLine(findings[index]))
		}
	}
	if inputs.Coverage != nil {
		writeUncovered(&out, inputs.Coverage.Uncovered())
	}
	return out.String()
}

func findingRows(rows []Row) []Row {
	var findings []Row
	for index := range rows {
		if rows[index].Finding() {
			findings = append(findings, rows[index])
		}
	}
	sort.SliceStable(findings, func(a, b int) bool {
		return classRank(findings[a].Class) < classRank(findings[b].Class)
	})
	return findings
}

// findingLine is `[edition] class screen: why · evidence`.
func findingLine(row Row) string {
	line := fmt.Sprintf("[%s] %s %s: %s", row.Edition, row.Class, rowTitle(row), row.Why)
	if evidence := RowEvidence(row); evidence != "" {
		line += " · " + evidence
	}
	return line
}

func writeClassTable(out *strings.Builder, inputs SummaryInputs) {
	counts := map[Classification]map[Edition]int{}
	for index := range inputs.Rows {
		row := &inputs.Rows[index]
		if counts[row.Class] == nil {
			counts[row.Class] = map[Edition]int{}
		}
		counts[row.Class][row.Edition]++
	}
	editions := inputs.Editions
	if len(editions) == 0 {
		editions = []Edition{""}
	}
	fmt.Fprintf(out, "\n%-18s", "class")
	for _, edition := range editions {
		fmt.Fprintf(out, " %12s", editionLabel(edition))
	}
	fmt.Fprintln(out)
	for _, class := range classOrder {
		if counts[class] != nil {
			out.WriteString(classRow(class, editions, counts[class]))
		}
	}
}

// classRow is one class's counts; "!" marks a class that fails the run.
func classRow(class Classification, editions []Edition, counts map[Edition]int) string {
	marker := " "
	if class.IsFinding() {
		marker = "!"
	}
	row := fmt.Sprintf("%s %-16s", marker, class)
	for _, edition := range editions {
		row += fmt.Sprintf(" %12d", counts[edition])
	}
	return row + "\n"
}

func editionLabel(edition Edition) string {
	if edition == "" {
		return "screens"
	}
	return string(edition)
}

func writeUncovered(out *strings.Builder, uncovered []CoverageEntry) {
	if len(uncovered) == 0 {
		return
	}
	fmt.Fprintf(out, "\nuncovered routes (%d), add each to visualdiff.yaml routes or coverage.excluded:\n", len(uncovered))
	for index, entry := range uncovered {
		if index == summaryUncovered {
			fmt.Fprintf(out, "  and %d more\n", len(uncovered)-summaryUncovered)
			break
		}
		kind := "static"
		if entry.Dynamic() {
			kind = "dynamic"
		}
		fmt.Fprintf(out, "  %s (%s, %s)\n", entry.Pattern, kind, strings.Join(entry.Sources, "+"))
	}
}

// WriteSummaryFile writes summary.txt into the run directory.
func WriteSummaryFile(runDir, summary string) error {
	if err := os.MkdirAll(runDir, 0o750); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(runDir, SummaryFile), []byte(summary), 0o600)
}

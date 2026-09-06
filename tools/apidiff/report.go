package apidiff

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/openapidiff"
)

// SpecChange is one spec-level difference. Kind is the openapidiff change
// kind mapped to its report name (operation_added, component_changed, …);
// raw keeps the original change so the human summary can reuse
// openapidiff.Render exactly.
type SpecChange struct {
	Kind   string            `json:"kind"`
	Path   string            `json:"path"`
	Method string            `json:"method"`
	Fields map[string][2]any `json:"fields,omitempty"`

	raw openapidiff.Change
}

// Report is the full machine-readable result of a probe run.
type Report struct {
	SpecChanges      []SpecChange     `json:"specChanges"`
	Findings         []Finding        `json:"findings"`
	Transcripts      []Transcript     `json:"transcripts"`
	OperationsProbed int              `json:"operationsProbed"`
	Differences      int              `json:"differences"`
	Suppressed       SuppressedCounts `json:"suppressed"`
}

// MapSpecChanges maps openapidiff changes to report entries.
func MapSpecChanges(changes []openapidiff.Change) []SpecChange {
	mapped := make([]SpecChange, 0, len(changes))
	for _, change := range changes {
		mapped = append(mapped, SpecChange{
			Kind:   SpecChangeKind(change),
			Path:   change.Path,
			Method: change.Method,
			Fields: change.Fields,
			raw:    change,
		})
	}
	return mapped
}

// BuildReport assembles the report and counts behavioral differences:
// every spec change plus every finding that is not a skip or a coverage note
// (unverified_shape lists gaps, not differences).
func BuildReport(changes []openapidiff.Change, result ProbeResult) Report {
	report := Report{
		SpecChanges:      MapSpecChanges(changes),
		Findings:         result.Findings,
		Transcripts:      result.Transcripts,
		OperationsProbed: result.Probed,
		Suppressed:       result.Suppressed,
	}
	report.Differences = len(changes)
	for _, finding := range result.Findings {
		if finding.Kind != FindingSkipped && finding.Kind != FindingUnverifiedShape {
			report.Differences++
		}
	}
	if report.Findings == nil {
		report.Findings = []Finding{}
	}
	if report.Transcripts == nil {
		report.Transcripts = []Transcript{}
	}
	return report
}

// findingKindOrder fixes the section order of the human summary.
var findingKindOrder = []string{
	FindingStatusDiff,
	FindingBodyShapeDiff,
	FindingBodyValueDiff,
	FindingErrorShapeDiff,
	FindingOperationMissing,
	FindingPermissionLeak,
	FindingPermissionDiff,
	FindingMutationNotVisible,
	FindingProbeFailed,
	FindingSkipped,
	FindingUnverifiedShape,
}

// WriteHumanSummary renders the deterministic stdout summary: spec changes
// first (via openapidiff.Render), then findings grouped by kind and sorted by
// path+method, per-kind counts, and the closing totals line.
func WriteHumanSummary(writer io.Writer, report Report) error {
	var output strings.Builder
	output.WriteString("spec changes:\n")
	raw := make([]openapidiff.Change, 0, len(report.SpecChanges))
	for _, change := range report.SpecChanges {
		raw = append(raw, change.raw)
	}
	output.WriteString(openapidiff.Render(raw))
	writeFindingsSection(&output, report.Findings)
	writeTotalsLine(&output, report)
	_, err := io.WriteString(writer, output.String())
	return err
}

// writeFindingsSection groups findings by kind, in the fixed findingKindOrder
// section order, each sorted by path, method, then case.
func writeFindingsSection(output *strings.Builder, all []Finding) {
	byKind := map[string][]Finding{}
	for _, finding := range all {
		byKind[finding.Kind] = append(byKind[finding.Kind], finding)
	}
	output.WriteString("findings:\n")
	if len(all) == 0 {
		output.WriteString("  none\n")
	}
	for _, kind := range findingKindOrder {
		if findings := byKind[kind]; len(findings) > 0 {
			writeKindSection(output, kind, findings)
		}
	}
}

func writeKindSection(output *strings.Builder, kind string, findings []Finding) {
	sort.Slice(findings, func(i, j int) bool {
		if findings[i].Path != findings[j].Path {
			return findings[i].Path < findings[j].Path
		}
		if findings[i].Method != findings[j].Method {
			return findings[i].Method < findings[j].Method
		}
		return findings[i].Case < findings[j].Case
	})
	fmt.Fprintf(output, "  %s (%d):\n", kind, len(findings))
	for _, finding := range findings {
		output.WriteString("    ")
		output.WriteString(findingLine(finding))
		output.WriteByte('\n')
	}
}

func writeTotalsLine(output *strings.Builder, report Report) {
	if report.Differences == 0 {
		fmt.Fprintf(output, "no behavioral differences across %d operations probed\n", report.OperationsProbed)
	} else {
		fmt.Fprintf(output, "%d differences across %d operations probed\n", report.Differences, report.OperationsProbed)
	}
	if report.Suppressed.SameClassStatus > 0 || report.Suppressed.ErrorBody > 0 {
		fmt.Fprintf(output, "suppressed: %d same-class status differences, %d error-body comparisons (use -exact-status to compare them)\n",
			report.Suppressed.SameClassStatus, report.Suppressed.ErrorBody)
	}
	unverified := 0
	for _, finding := range report.Findings {
		if finding.Kind == FindingUnverifiedShape {
			unverified++
		}
	}
	if unverified > 0 {
		fmt.Fprintf(output, "unverified: %d list endpoints returned empty on both sides (item shape not exercised)\n", unverified)
	}
}

// findingLine renders one finding as a single deterministic line.
func findingLine(finding Finding) string {
	var line strings.Builder
	line.WriteString(finding.Method)
	line.WriteByte(' ')
	line.WriteString(finding.Path)
	if finding.Case != "" {
		line.WriteString(" [")
		line.WriteString(finding.Case)
		line.WriteByte(']')
	}
	if finding.Reason != "" {
		line.WriteString(": ")
		line.WriteString(finding.Reason)
		return line.String()
	}
	if len(finding.Fields) > 0 {
		encoded, err := json.Marshal(finding.Fields)
		if err == nil {
			line.WriteByte(' ')
			line.Write(encoded)
		}
	}
	return line.String()
}

// WriteJSONReport writes the machine report as indented JSON.
func WriteJSONReport(writer io.Writer, report Report) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}

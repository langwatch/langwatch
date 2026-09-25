package apidiff

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
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
	// CredentialChecks says whether the run's own credentials outlived it.
	// A reader must be able to tell a difference that was FIXED from one that
	// disappeared because the probe went blind; this is that evidence.
	CredentialChecks []CredentialCheck `json:"credentialChecks"`
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
		CredentialChecks: result.CredentialChecks,
	}
	report.Differences = len(changes)
	for _, finding := range result.Findings {
		// Skips are harness notes, unverified_shape is a coverage gap, and an
		// improved-error finding is drift the tool grants on sight — see
		// improved-error.go and the README's "Improved-error acceptance": none
		// of the three is a behavioral regression to fail the run over.
		if finding.Kind != FindingSkipped && finding.Kind != FindingUnverifiedShape && finding.Kind != FindingErrorImproved {
			report.Differences++
		}
	}
	if report.Findings == nil {
		report.Findings = []Finding{}
	}
	if report.Transcripts == nil {
		report.Transcripts = []Transcript{}
	}
	if report.CredentialChecks == nil {
		report.CredentialChecks = []CredentialCheck{}
	}
	return report
}

// findingKindOrder fixes the section order of the human summary.
var findingKindOrder = []string{
	FindingStatusDiff,
	FindingErrorImproved,
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
	writeCredentialSection(&output, report.CredentialChecks)
	_, err := io.WriteString(writer, output.String())
	return err
}

// writeCredentialSection prints the run's own integrity reading. A healthy run
// gets one line saying the credentials outlived it, because "nothing printed"
// and "nothing checked" look identical, and telling them apart is the entire
// point of the check.
func writeCredentialSection(output *strings.Builder, checks []CredentialCheck) {
	if len(checks) == 0 {
		return
	}
	doubtful := make([]CredentialCheck, 0, len(checks))
	for _, check := range checks {
		if !check.Healthy() {
			doubtful = append(doubtful, check)
		}
	}
	if len(doubtful) == 0 {
		fmt.Fprintf(output, "credentials: all %d still authenticate on both sides after the run\n", len(checks))
		return
	}
	fmt.Fprintf(output, "credentials: %d of %d did not survive the run intact\n", len(doubtful), len(checks))
	for _, check := range doubtful {
		fmt.Fprintf(output, "  %s: %s\n", check.Label, check.Note)
	}
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
	improved := 0
	for _, finding := range report.Findings {
		switch finding.Kind {
		case FindingUnverifiedShape:
			unverified++
		case FindingErrorImproved:
			improved++
		}
	}
	if unverified > 0 {
		fmt.Fprintf(output, "unverified: %d list endpoints returned empty on both sides (item shape not exercised)\n", unverified)
	}
	if improved > 0 {
		fmt.Fprintf(output, "improved: %d operation(s) replaced a base 5xx (or unhandled) failure with a branch handled 4xx — accepted, not counted as a difference\n", improved)
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

// packetExcerpt caps each body or value quoted in a module packet.
const packetExcerpt = 240

// WriteModulePackets writes one markdown packet per module that has a cause
// or a coverage note into dir, so a lane can act on its module without the
// full report: each operation's cases with both sides' request, status and
// differing pointers, quoted short. It returns the files written.
func WriteModulePackets(dir string, ledger Ledger, report Report) ([]string, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	evidence := indexEvidence(report)
	notes := map[string][]LedgerRow{}
	for index := range ledger.Operations {
		row := &ledger.Operations[index]
		if row.CoverageNote != "" {
			notes[row.Module] = append(notes[row.Module], *row)
		}
	}
	var written []string
	for _, module := range ledger.Modules {
		if len(module.Causes) == 0 && len(notes[module.Module]) == 0 {
			continue
		}
		path := filepath.Join(dir, packetName(module.Module)+".md")
		packet := renderModulePacket(module, notes[module.Module], evidence)
		if err := os.WriteFile(path, []byte(packet), 0o600); err != nil {
			return written, err
		}
		written = append(written, path)
	}
	return written, nil
}

func packetName(module string) string {
	if module == "" {
		return "unmapped"
	}
	return module
}

// packetEvidence is the report indexed by operation key.
type packetEvidence struct {
	findings    map[string][]Finding
	transcripts map[string][]Transcript
}

func indexEvidence(report Report) packetEvidence {
	evidence := packetEvidence{findings: map[string][]Finding{}, transcripts: map[string][]Transcript{}}
	for index := range report.Findings {
		finding := &report.Findings[index]
		key := finding.Method + " " + finding.Path
		evidence.findings[key] = append(evidence.findings[key], *finding)
	}
	for index := range report.Transcripts {
		transcript := &report.Transcripts[index]
		key := transcript.Method + " " + transcript.Path
		evidence.transcripts[key] = append(evidence.transcripts[key], *transcript)
	}
	return evidence
}

func renderModulePacket(module LedgerModule, notes []LedgerRow, evidence packetEvidence) string {
	var output strings.Builder
	fmt.Fprintf(&output, "# Probe packet: %s\n\n", moduleLabel(module.Module))
	fmt.Fprintf(&output, "%d operations, %d differing, %d causes (%d new), %d coverage notes. Base is main, branch is the candidate.\n",
		module.Operations, module.Differing, len(module.Causes), module.NewCauses, len(notes))
	for _, cause := range module.Causes {
		status := "new"
		if cause.Known {
			status = "known"
		}
		fmt.Fprintf(&output, "\n## %s [%s]\n", cause.RootCause, status)
		for _, operation := range cause.Operations {
			fmt.Fprintf(&output, "\n### %s\n\n", operation)
			evidence.write(&output, cause.RootCause, operation)
		}
	}
	if len(notes) > 0 {
		output.WriteString("\n## Coverage notes (never a cause, never fails the run)\n\n")
		for index := range notes {
			row := &notes[index]
			fmt.Fprintf(&output, "- %s %s: %s (%s)\n", row.Method, row.Path, row.CoverageNote, row.SkipReason)
		}
	}
	return output.String()
}

func (evidence packetEvidence) write(output *strings.Builder, cause, operation string) {
	matched := 0
	transcripts := evidence.transcripts[operation]
	findings := evidence.findings[operation]
	for index := range findings {
		finding := &findings[index]
		if RootCause(*finding) != cause {
			continue
		}
		matched++
		fmt.Fprintf(output, "- case %s: %s\n", caseLabel(finding.Case), finding.Kind)
		if finding.Reason != "" {
			fmt.Fprintf(output, "  - reason: %s\n", excerpt(finding.Reason))
		}
		for _, pointer := range sortedPointers(finding.Fields) {
			pair := finding.Fields[pointer]
			fmt.Fprintf(output, "  - `%s`: base %s, branch %s\n", pointer, excerptValue(pair[0]), excerptValue(pair[1]))
		}
		if transcript, ok := packetTranscript(transcripts, finding.Case); ok {
			writeTranscript(output, transcript)
		}
	}
	if matched == 0 {
		output.WriteString("- document-level change (spec diff); no probe finding carries this cause\n")
	}
}

func caseLabel(name string) string {
	if name == "" {
		return "-"
	}
	return name
}

func sortedPointers(fields map[string][2]any) []string {
	pointers := make([]string, 0, len(fields))
	for pointer := range fields {
		pointers = append(pointers, pointer)
	}
	sort.Strings(pointers)
	return pointers
}

func packetTranscript(transcripts []Transcript, caseName string) (Transcript, bool) {
	for index := range transcripts {
		if transcripts[index].Case == caseName || caseName == "" {
			return transcripts[index], true
		}
	}
	return Transcript{}, false
}

func writeTranscript(output *strings.Builder, transcript Transcript) {
	fmt.Fprintf(output, "  - base: %s %s -> %d `%s`\n", transcript.Method, transcript.RequestPathB, transcript.B.Status, excerpt(sideBody(transcript.B)))
	fmt.Fprintf(output, "  - branch: %s %s -> %d `%s`\n", transcript.Method, transcript.RequestPathA, transcript.A.Status, excerpt(sideBody(transcript.A)))
	if transcript.RequestBody != nil {
		fmt.Fprintf(output, "  - request body: %s\n", excerptValue(transcript.RequestBody))
	}
}

func sideBody(side SideResult) string {
	if side.Error != "" {
		return "error: " + side.Error
	}
	return side.Body
}

func excerptValue(value any) string {
	if text, ok := value.(string); ok {
		return "`" + excerpt(text) + "`"
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("`%v`", value)
	}
	return "`" + excerpt(string(encoded)) + "`"
}

func excerpt(text string) string {
	flat := strings.Join(strings.Fields(strings.ReplaceAll(text, "`", "'")), " ")
	if len(flat) <= packetExcerpt {
		return flat
	}
	return flat[:packetExcerpt] + "..."
}

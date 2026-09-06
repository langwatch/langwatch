package apidiff

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
)

// The ledger is the burn-down view of a run. A report of 78 difference rows
// is a list to sort by hand; the same run's ledger is "13 causes across 41
// operations", because every row carries a ROOT CAUSE — a stable slug the
// tool derives from the finding's kind, the status pair, and (for a skip)
// whether the harness or the API was the reason. Causes are what a branch
// drives to zero: -ledger-baseline marks the ones already known, and only a
// new cause fails the run.

// Classification is the closed enum one operation's outcome falls into.
const (
	ClassificationEqual           = "equal"
	ClassificationEqualSuppressed = "equal-suppressed"
	ClassificationDiffers         = "differs"
	ClassificationMissingA        = "missing-a"
	ClassificationMissingB        = "missing-b"
	ClassificationSkipped         = "skipped"
	ClassificationNotProbed       = "not-probed"
	ClassificationUnverified      = "unverified"
)

// Classifications lists the enum in report order.
var Classifications = []string{
	ClassificationEqual,
	ClassificationEqualSuppressed,
	ClassificationDiffers,
	ClassificationMissingA,
	ClassificationMissingB,
	ClassificationSkipped,
	ClassificationNotProbed,
	ClassificationUnverified,
}

// LedgerRow is one operation in the union, whether or not it differed.
type LedgerRow struct {
	Method         string   `json:"method"`
	Path           string   `json:"path"`
	OperationID    string   `json:"operationId,omitempty"`
	Presence       string   `json:"presence"` // both | candidate-only | base-only
	Cases          []string `json:"cases"`
	Classification string   `json:"classification"`
	RootCauses     []string `json:"rootCauses"`
	SkipReason     string   `json:"skipReason,omitempty"`
	SideStatus     *[2]int  `json:"sideStatus,omitempty"` // [base, candidate]
	Known          bool     `json:"known"`                // every cause is in the baseline
}

// LedgerCause groups every row sharing one root cause.
type LedgerCause struct {
	RootCause  string   `json:"rootCause"`
	Kind       string   `json:"kind"`
	Count      int      `json:"count"` // findings carrying this cause
	Operations []string `json:"operations"`
	Known      bool     `json:"known"` // present in the -ledger-baseline
}

// LedgerTotals is the burn-down headline.
type LedgerTotals struct {
	UnionOperations int `json:"unionOperations"`
	Probed          int `json:"probed"`
	Skipped         int `json:"skipped"`
	Differing       int `json:"differingOperations"`
	Causes          int `json:"causes"`
	NewCauses       int `json:"newCauses"`
	KnownCauses     int `json:"knownCauses"`
}

// Ledger is the machine-readable per-operation view, written beside the
// report as ledger.json.
type Ledger struct {
	Totals     LedgerTotals  `json:"totals"`
	Causes     []LedgerCause `json:"causes"`
	Operations []LedgerRow   `json:"operations"`
}

// ledgerBuild accumulates the rows and cause groups while folding a run.
type ledgerBuild struct {
	rows     map[string]*LedgerRow
	order    []string
	causes   map[string]*LedgerCause
	baseline map[string]bool
	hasBase  bool
}

// BuildLedger folds the union, the findings and the spec changes into one
// row per operation plus the cause groups. baseline may be nil.
func BuildLedger(union []Operation, report Report, baseline map[string]bool) Ledger {
	build := &ledgerBuild{
		rows:     map[string]*LedgerRow{},
		causes:   map[string]*LedgerCause{},
		baseline: baseline,
		hasBase:  baseline != nil,
	}
	build.seedRows(union)
	build.applyTranscripts(report.Transcripts)
	build.applyFindings(report.Findings)
	build.applySpecChanges(report.SpecChanges)
	return build.finish()
}

// seedRows creates one row per union operation, in the union's own order.
func (build *ledgerBuild) seedRows(union []Operation) {
	for index := range union {
		operation := union[index]
		key := operationKeyOf(operation)
		row := &LedgerRow{
			Method:         operation.Method,
			Path:           operation.Path,
			OperationID:    operation.OperationID,
			Presence:       presenceOf(operation),
			Cases:          []string{},
			Classification: ClassificationNotProbed,
			RootCauses:     []string{},
		}
		build.rows[key] = row
		build.order = append(build.order, key)
	}
}

func presenceOf(operation Operation) string {
	switch {
	case operation.InA && operation.InB:
		return "both"
	case operation.InA:
		return "candidate-only"
	default:
		return "base-only"
	}
}

// applyTranscripts records which cases ran and each operation's status pair.
func (build *ledgerBuild) applyTranscripts(transcripts []Transcript) {
	for index := range transcripts {
		transcript := transcripts[index]
		row, ok := build.rows[transcript.Method+" "+transcript.Path]
		if !ok {
			continue
		}
		if !contains(row.Cases, transcript.Case) {
			row.Cases = append(row.Cases, transcript.Case)
		}
		if row.SideStatus == nil {
			row.SideStatus = &[2]int{transcript.B.Status, transcript.A.Status}
		}
		if row.Classification == ClassificationNotProbed {
			row.Classification = ClassificationEqual
		}
	}
}

// applyFindings attaches each finding's root cause to its row and to the
// cause group, and lifts the row's classification.
func (build *ledgerBuild) applyFindings(findings []Finding) {
	for index := range findings {
		finding := findings[index]
		key := finding.Method + " " + finding.Path
		row, ok := build.rows[key]
		if !ok {
			row = &LedgerRow{
				Method: finding.Method, Path: finding.Path, OperationID: finding.OperationID,
				Presence: "both", Cases: []string{}, Classification: ClassificationEqual, RootCauses: []string{},
			}
			build.rows[key] = row
			build.order = append(build.order, key)
		}
		cause := RootCause(finding)
		if !contains(row.RootCauses, cause) {
			row.RootCauses = append(row.RootCauses, cause)
		}
		build.recordCause(cause, finding.Kind, key)
		build.classify(row, finding)
	}
}

// classify lifts a row's classification for one finding. differs wins over
// everything; a missing operation reports which side lost it.
func (build *ledgerBuild) classify(row *LedgerRow, finding Finding) {
	switch finding.Kind {
	case FindingSkipped:
		if row.Classification == ClassificationEqual || row.Classification == ClassificationNotProbed {
			row.Classification = ClassificationSkipped
			row.SkipReason = finding.Reason
		}
	case FindingUnverifiedShape:
		if row.Classification == ClassificationEqual || row.Classification == ClassificationNotProbed {
			row.Classification = ClassificationUnverified
		}
	case FindingOperationMissing:
		if row.Presence == "candidate-only" {
			row.Classification = ClassificationMissingB
			return
		}
		row.Classification = ClassificationMissingA
	default:
		row.Classification = ClassificationDiffers
	}
}

// applySpecChanges records the document-level differences as causes of their
// own, on the operation's row when the union has one.
func (build *ledgerBuild) applySpecChanges(changes []SpecChange) {
	for index := range changes {
		change := changes[index]
		cause := "spec-" + strings.ReplaceAll(change.Kind, "_", "-")
		key := strings.ToUpper(change.Method) + " " + CanonicalAliasPath(change.Path)
		if row, ok := build.rows[key]; ok && !contains(row.RootCauses, cause) {
			row.RootCauses = append(row.RootCauses, cause)
		}
		build.recordCause(cause, change.Kind, key)
	}
}

func (build *ledgerBuild) recordCause(cause, kind, operationKey string) {
	group, ok := build.causes[cause]
	if !ok {
		group = &LedgerCause{RootCause: cause, Kind: kind, Known: build.baseline[cause]}
		build.causes[cause] = group
	}
	group.Count++
	if !contains(group.Operations, operationKey) {
		group.Operations = append(group.Operations, operationKey)
	}
}

// finish sorts everything deterministically and computes the totals.
func (build *ledgerBuild) finish() Ledger {
	ledger := Ledger{}
	ledger.Operations, ledger.Totals = build.finishRows()
	ledger.Causes = build.finishCauses(&ledger.Totals)
	ledger.Totals.UnionOperations = len(ledger.Operations)
	ledger.Totals.Causes = len(ledger.Causes)
	return ledger
}

// finishRows orders the rows and counts what each classification means for
// the burn-down.
func (build *ledgerBuild) finishRows() ([]LedgerRow, LedgerTotals) {
	rows := make([]LedgerRow, 0, len(build.order))
	totals := LedgerTotals{}
	sort.Strings(build.order)
	for _, key := range build.order {
		row := build.rows[key]
		sort.Strings(row.RootCauses)
		row.Known = build.hasBase && len(row.RootCauses) > 0 && allKnown(row.RootCauses, build.baseline)
		rows = append(rows, *row)
		switch row.Classification {
		case ClassificationDiffers, ClassificationMissingA, ClassificationMissingB:
			totals.Differing++
			totals.Probed++
		case ClassificationSkipped:
			totals.Skipped++
		case ClassificationNotProbed:
		default:
			totals.Probed++
		}
	}
	return rows, totals
}

// finishCauses orders the cause groups and splits them into known and new.
func (build *ledgerBuild) finishCauses(totals *LedgerTotals) []LedgerCause {
	names := make([]string, 0, len(build.causes))
	for name := range build.causes {
		names = append(names, name)
	}
	sort.Strings(names)
	causes := make([]LedgerCause, 0, len(names))
	for _, name := range names {
		group := build.causes[name]
		sort.Strings(group.Operations)
		causes = append(causes, *group)
		if group.Known {
			totals.KnownCauses++
			continue
		}
		totals.NewCauses++
	}
	return causes
}

func allKnown(causes []string, baseline map[string]bool) bool {
	for _, cause := range causes {
		if !baseline[cause] {
			return false
		}
	}
	return true
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// RootCause derives one finding's stable cause slug. Two findings share a
// slug when fixing one plausibly fixes the other: the 14 webhook rows of the
// 2026-09-05 run are one handled-refusal-degraded cause, and the five
// not-found regressions are one not-found-as-500.
func RootCause(finding Finding) string {
	before, after, hasStatus := statusPair(finding)
	switch finding.Kind {
	case FindingOperationMissing:
		return missingCause(finding)
	case FindingSkipped:
		if strings.Contains(finding.Reason, "resolvable on the") {
			return "harness-symbol-table"
		}
		return "unresolvable-parameter"
	case FindingUnverifiedShape:
		return "unverified-list-shape"
	case FindingStatusDiff:
		if !hasStatus {
			return "status-class-mismatch"
		}
		return statusCause(before, after)
	case FindingPermissionDiff:
		if !hasStatus {
			return "permission-diff"
		}
		return withPair("permission-diff", before, after)
	case FindingPermissionLeak:
		return "permission-leak"
	case FindingMutationNotVisible:
		return "mutation-not-visible"
	case FindingBodyShapeDiff:
		return "body-shape-diff"
	case FindingBodyValueDiff:
		return "body-value-diff"
	case FindingErrorShapeDiff:
		return "error-shape-diff"
	case FindingProbeFailed:
		return "probe-failed"
	default:
		return strings.ReplaceAll(finding.Kind, "_", "-")
	}
}

// missingCause names which side lost the operation.
func missingCause(finding Finding) string {
	presence, ok := finding.Fields["presence"]
	if ok {
		if after, _ := presence[1].(string); after == "absent" {
			return "operation-missing-on-candidate"
		}
		return "operation-missing-on-base"
	}
	return "operation-missing"
}

// statusCause names the shape of a status-class flip, always carrying the
// specific pair so two different flips never collapse into one cause.
func statusCause(before, after int) string {
	switch {
	case before == 404 && after >= 500:
		return withPair("not-found-as-500", before, after)
	case before >= 400 && before < 500 && after >= 500:
		return withPair("handled-refusal-degraded", before, after)
	case before >= 500 && after < 500:
		return withPair("server-error-resolved", before, after)
	case before >= 200 && before < 300 && after == 404:
		return withPair("route-absent-on-candidate", before, after)
	case after >= 200 && after < 300 && before == 404:
		return withPair("route-absent-on-base", before, after)
	default:
		return withPair("status-class-mismatch", before, after)
	}
}

func withPair(slug string, before, after int) string {
	return slug + ":" + strconv.Itoa(before) + "-" + strconv.Itoa(after)
}

// statusPair reads the [base, candidate] status pair off a finding.
func statusPair(finding Finding) (before, after int, ok bool) {
	pair, present := finding.Fields["status"]
	if !present {
		return 0, 0, false
	}
	before, okBefore := asInt(pair[0])
	after, okAfter := asInt(pair[1])
	return before, after, okBefore && okAfter
}

// asInt reads a status out of a field value, which is an int in memory and a
// json.Number or float64 after a round trip through the report file.
func asInt(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		return int(parsed), err == nil
	case string:
		parsed, err := strconv.Atoi(typed)
		return parsed, err == nil
	default:
		return 0, false
	}
}

// LoadCauseBaseline reads a set of known causes from a previous run's
// ledger.json, or from a plain JSON array of cause slugs.
func LoadCauseBaseline(path string) (map[string]bool, error) {
	data, err := os.ReadFile(path) // #nosec G304 -- operator-supplied baseline path
	if err != nil {
		return nil, fmt.Errorf("ledger baseline: %w", err)
	}
	known := map[string]bool{}
	var ledger Ledger
	if err := json.Unmarshal(data, &ledger); err == nil && len(ledger.Causes) > 0 {
		for _, cause := range ledger.Causes {
			known[cause.RootCause] = true
		}
		return known, nil
	}
	var slugs []string
	if err := json.Unmarshal(data, &slugs); err != nil {
		return nil, fmt.Errorf("ledger baseline %s: expected a ledger.json or a JSON array of cause slugs", path)
	}
	for _, slug := range slugs {
		known[slug] = true
	}
	return known, nil
}

// WriteLedger writes the ledger as indented JSON.
func WriteLedger(writer io.Writer, ledger Ledger) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(ledger)
}

// WriteCauseSummary renders the human head of the report: the causes, each
// with how many operations carry it, newest work first (unknown causes
// before known ones when a baseline is in play).
func WriteCauseSummary(writer io.Writer, ledger Ledger) error {
	var output strings.Builder
	fmt.Fprintf(&output, "root causes: %d causes across %d operations (%d in the union)\n",
		ledger.Totals.Causes, ledger.Totals.Differing+ledger.Totals.Skipped, ledger.Totals.UnionOperations)
	if ledger.Totals.Causes == 0 {
		output.WriteString("  none\n")
	}
	for _, cause := range sortedCauses(ledger.Causes) {
		marker := ""
		if cause.Known {
			marker = " [known]"
		}
		fmt.Fprintf(&output, "  %s%s: %d findings across %d operations\n", cause.RootCause, marker, cause.Count, len(cause.Operations))
		for _, operation := range cause.Operations {
			fmt.Fprintf(&output, "    %s\n", operation)
		}
	}
	_, err := io.WriteString(writer, output.String())
	return err
}

// sortedCauses orders unknown causes first, then by descending operation
// count, then by name — the order a burn-down is worked in.
func sortedCauses(causes []LedgerCause) []LedgerCause {
	ordered := make([]LedgerCause, len(causes))
	copy(ordered, causes)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].Known != ordered[j].Known {
			return !ordered[i].Known
		}
		if len(ordered[i].Operations) != len(ordered[j].Operations) {
			return len(ordered[i].Operations) > len(ordered[j].Operations)
		}
		return ordered[i].RootCause < ordered[j].RootCause
	})
	return ordered
}
